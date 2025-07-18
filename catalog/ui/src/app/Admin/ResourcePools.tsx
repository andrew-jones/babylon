import React, { useCallback, useMemo, useReducer } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyState,
  EmptyStateIcon,
  PageSection,
  PageSectionVariants,
  Split,
  SplitItem,
  Title,
  EmptyStateHeader,
} from '@patternfly/react-core';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/js/icons/exclamation-triangle-icon';
import { apiPaths, deleteResourcePool, fetcherItemsInAllPages } from '@app/api';
import { selectedUidsReducer } from '@app/reducers';
import { ResourcePool } from '@app/types';
import { ActionDropdown, ActionDropdownItem } from '@app/components/ActionDropdown';
import KeywordSearchInput from '@app/components/KeywordSearchInput';
import LocalTimestamp from '@app/components/LocalTimestamp';
import OpenshiftConsoleLink from '@app/components/OpenshiftConsoleLink';
import TimeInterval from '@app/components/TimeInterval';
import { compareK8sObjectsArr, FETCH_BATCH_LIMIT } from '@app/util';
import useMatchMutate from '@app/utils/useMatchMutate';
import ResourcePoolStats from './ResourcePoolStats';
import SelectableTableWithPagination from '@app/components/SelectableTableWithPagination';
import useSWR from 'swr';
import Footer from '@app/components/Footer';

import './admin.css';

function keywordMatch(resourcePool: ResourcePool, keyword: string): boolean {
  if (resourcePool.metadata.name.includes(keyword)) {
    return true;
  }
  for (const resource of resourcePool.spec.resources) {
    if (resource.provider.name.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function filterResourcePool(resourcePool: ResourcePool, keywordFilter: string[]): boolean {
  if (!keywordFilter) {
    return true;
  }
  for (const keyword of keywordFilter) {
    if (!keywordMatch(resourcePool, keyword)) {
      return false;
    }
  }
  return true;
}

const ResourcePools: React.FC = () => {
  const matchMutate = useMatchMutate();
  const [searchParams, setSearchParams] = useSearchParams();
  const keywordFilter = useMemo(
    () =>
      searchParams.has('search')
        ? searchParams
            .get('search')
            .trim()
            .split(/ +/)
            .filter((w) => w != '')
        : null,
    [searchParams.get('search')],
  );
  const [selectedUids, reduceSelectedUids] = useReducer(selectedUidsReducer, []);

  const { data: resourcePools, mutate } = useSWR<ResourcePool[]>(
    apiPaths.RESOURCE_POOLS({ limit: 'ALL' }),
    () =>
      fetcherItemsInAllPages((continueId) =>
        apiPaths.RESOURCE_POOLS({
          limit: FETCH_BATCH_LIMIT,
          continueId,
        }),
      ),
    {
      refreshInterval: 8000,
      compare: compareK8sObjectsArr,
    },
  );

  const revalidate = useCallback(
    ({ updatedItems, action }: { updatedItems: ResourcePool[]; action: 'update' | 'delete' }) => {
      const resourcePoolsCpy = [...resourcePools];
      for (const updatedItem of updatedItems) {
        const foundIndex = resourcePools.findIndex((r) => r.metadata.uid === updatedItem.metadata.uid);
        if (foundIndex > -1) {
          if (action === 'update') {
            matchMutate([
              {
                name: 'RESOURCE_POOL',
                arguments: { resourcePoolName: resourcePoolsCpy[foundIndex].metadata.name },
                data: updatedItem,
              },
            ]);
            resourcePoolsCpy[foundIndex] = updatedItem;
          } else if (action === 'delete') {
            matchMutate([
              {
                name: 'RESOURCE_POOL',
                arguments: { resourcePoolName: resourcePoolsCpy[foundIndex].metadata.name },
                data: undefined,
              },
            ]);
            resourcePoolsCpy.splice(foundIndex, 1);
          }
          mutate(resourcePoolsCpy);
        }
      }
    },
    [matchMutate, mutate, resourcePools],
  );

  const filterFunction = useCallback(
    (resourcePool: ResourcePool) => filterResourcePool(resourcePool, keywordFilter),
    [keywordFilter],
  );

  const _resourcePools: ResourcePool[] = useMemo(
    () => [].concat(...resourcePools.filter(filterFunction)) || [],
    [filterFunction, resourcePools],
  );

  async function confirmThenDelete(): Promise<void> {
    if (confirm('Deleted selected ResourcePools?')) {
      const removedResourcePools: ResourcePool[] = [];
      for (const resourcePool of resourcePools) {
        if (selectedUids.includes(resourcePool.metadata.uid)) {
          await deleteResourcePool(resourcePool);
          removedResourcePools.push(resourcePool);
        }
      }
      reduceSelectedUids({ type: 'clear' });
      revalidate({ action: 'delete', updatedItems: removedResourcePools });
    }
  }

  return (
    <div className="admin-container">
      <PageSection key="header" className="admin-header" variant={PageSectionVariants.light}>
        <Split hasGutter>
          <SplitItem isFilled>
            <Title headingLevel="h4" size="xl">
              ResourcePools
            </Title>
          </SplitItem>
          <SplitItem>
            <KeywordSearchInput
              initialValue={keywordFilter}
              onSearch={(value) => {
                if (value) {
                  searchParams.set('search', value.join(' '));
                } else if (searchParams.has('search')) {
                  searchParams.delete('search');
                }
                setSearchParams(searchParams);
              }}
            />
          </SplitItem>
          <SplitItem>
            <ActionDropdown
              actionDropdownItems={[
                <ActionDropdownItem key="delete" label="Delete Selected" onSelect={() => confirmThenDelete()} />,
              ]}
            />
          </SplitItem>
        </Split>
      </PageSection>
      {_resourcePools.length === 0 ? (
        <PageSection>
          <EmptyState variant="full">
            <EmptyStateHeader
              titleText="No ResourcePools found"
              icon={<EmptyStateIcon icon={ExclamationTriangleIcon} />}
              headingLevel="h1"
            />
          </EmptyState>
        </PageSection>
      ) : (
        <PageSection key="body" variant={PageSectionVariants.light} className="admin-body">
          <SelectableTableWithPagination
            columns={['Name', 'Created At', 'Status']}
            onSelectAll={(isSelected) => {
              if (isSelected) {
                reduceSelectedUids({ type: 'set', items: _resourcePools });
              } else {
                reduceSelectedUids({ type: 'clear' });
              }
            }}
            rows={_resourcePools.map((resourcePool) => {
              return {
                cells: [
                  <>
                    <Link key="admin" to={`/admin/resourcepools/${resourcePool.metadata.name}`}>
                      {resourcePool.metadata.name}
                    </Link>
                    <OpenshiftConsoleLink key="console" resource={resourcePool} />
                  </>,
                  <>
                    <LocalTimestamp key="timestamp" timestamp={resourcePool.metadata.creationTimestamp} />
                    <span key="interval" style={{ padding: '0 6px' }}>
                      (<TimeInterval key="time-interval" toTimestamp={resourcePool.metadata.creationTimestamp} />)
                    </span>
                  </>,
                  <>
                    <ResourcePoolStats
                      resourcePoolName={resourcePool.metadata.name}
                      minAvailable={resourcePool.spec.minAvailable}
                    />
                  </>,
                ],
                onSelect: (isSelected: boolean) => {
                  reduceSelectedUids({
                    type: isSelected ? 'add' : 'remove',
                    items: [resourcePool],
                  });
                },
                selected: selectedUids.includes(resourcePool.metadata.uid),
              };
            })}
          />
        </PageSection>
      )}
      <Footer />
    </div>
  );
};

export default ResourcePools;
