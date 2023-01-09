import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  Backdrop,
  Button,
  Card,
  CardBody,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  DrawerPanelContent,
  EmptyState,
  EmptyStateIcon,
  PageSection,
  PageSectionVariants,
  Select,
  SelectOption,
  SelectVariant,
  Sidebar,
  SidebarContent,
  SidebarPanel,
  Split,
  SplitItem,
  Stack,
  StackItem,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import DownloadIcon from '@patternfly/react-icons/dist/js/icons/download-icon';
import TimesIcon from '@patternfly/react-icons/dist/js/icons/times-icon';
import ListIcon from '@patternfly/react-icons/dist/js/icons/list-icon';
import ThIcon from '@patternfly/react-icons/dist/js/icons/th-icon';
import useSWRImmutable from 'swr/immutable';
import { AsyncParser } from 'json2csv';
import { apiPaths, fetcherItemsInAllPages } from '@app/api';
import { CatalogItem } from '@app/types';
import useSession from '@app/utils/useSession';
import KeywordSearchInput from '@app/components/KeywordSearchInput';
import { checkAccessControl, displayName, BABYLON_DOMAIN, FETCH_BATCH_LIMIT } from '@app/util';
import LoadingIcon from '@app/components/LoadingIcon';
import Footer from '@app/components/Footer';
import {
  formatString,
  getCategory,
  getLastFilter,
  HIDDEN_ANNOTATIONS,
  HIDDEN_LABELS,
  CUSTOM_LABELS,
  setLastFilter,
} from './catalog-utils';
import CatalogCategorySelector from './CatalogCategorySelector';
import CatalogInterfaceDescription from './CatalogInterfaceDescription';
import CatalogItemCard from './CatalogItemCard';
import CatalogItemDetails from './CatalogItemDetails';
import CatalogLabelSelector from './CatalogLabelSelector';
import CatalogNamespaceSelect from './CatalogNamespaceSelect';
import CatalogItemListItem from './CatalogItemListItem';

import './catalog.css';

function compareCatalogItems(a: CatalogItem, b: CatalogItem, method: 'Featured' | 'AZ' | 'ZA' = 'AZ'): number {
  const aDisplayName = displayName(a);
  const bDisplayName = displayName(b);
  if (aDisplayName !== bDisplayName) {
    if (method === 'AZ') {
      return aDisplayName < bDisplayName ? -1 : 1;
    } else if (method === 'ZA') {
      return aDisplayName < bDisplayName ? 1 : -1;
    } else {
      // method === 'Featured'
      const aRating = a.metadata.labels[`${BABYLON_DOMAIN}/Featured_Score`];
      const bRating = b.metadata.labels[`${BABYLON_DOMAIN}/Featured_Score`];
      if (aRating || bRating) {
        if (aRating && bRating) return parseInt(aRating, 10) < parseInt(bRating, 10) ? 1 : -1;
        if (bRating) return 1;
        return -1;
      }
      return aDisplayName < bDisplayName ? -1 : 1;
    }
  }
  const aStage = a.metadata.labels?.[`${BABYLON_DOMAIN}/stage`];
  const bStage = b.metadata.labels?.[`${BABYLON_DOMAIN}/stage`];
  if (aStage !== bStage) {
    return aStage === 'prod' && bStage !== 'prod'
      ? -1
      : aStage !== 'prod' && bStage === 'prod'
      ? 1
      : aStage === 'test' && bStage !== 'test'
      ? -1
      : aStage !== 'test' && bStage === 'test'
      ? 1
      : aStage === 'dev' && bStage !== 'dev'
      ? -1
      : aStage !== 'dev' && bStage === 'dev'
      ? 1
      : 0;
  }
  if (a.metadata.namespace != b.metadata.namespace) {
    return a.metadata.namespace < b.metadata.namespace ? -1 : 1;
  }
  if (a.metadata.name != b.metadata.name) {
    return a.metadata.name < b.metadata.name ? -1 : 1;
  }
  return 0;
}

function handleExportCsv(catalogItems: CatalogItem[]) {
  const annotations = [];
  const labels = [];
  catalogItems.forEach((ci) => {
    for (const annotation of Object.keys(ci.metadata.annotations || [])) {
      if (
        annotation.startsWith(BABYLON_DOMAIN + '/') &&
        !HIDDEN_ANNOTATIONS.includes(annotation.substring(BABYLON_DOMAIN.length + 1))
      ) {
        if (!annotations.includes(annotation)) annotations.push(annotation);
      }
    }
    for (const label of Object.keys(ci.metadata.labels || [])) {
      if (
        label.startsWith(BABYLON_DOMAIN + '/') &&
        !HIDDEN_LABELS.includes(label.substring(BABYLON_DOMAIN.length + 1))
      ) {
        if (!labels.includes(label)) labels.push(label);
      }
    }
  });

  const fields = [
    {
      label: 'Name',
      value: 'metadata.name',
      default: '',
    },
    {
      label: 'Catalog',
      value: 'metadata.namespace',
      default: '',
    },
  ];
  for (const annotation of annotations) {
    fields.push({
      label: formatString(annotation.substring(BABYLON_DOMAIN.length + 1)),
      value: `metadata.annotations.["${annotation}"]`,
      default: '',
    });
  }
  for (const label of labels) {
    fields.push({
      label: formatString(label.substring(BABYLON_DOMAIN.length + 1)),
      value: `metadata.labels.["${label}"]`,
      default: '',
    });
  }
  const opts = { fields };
  const transformOpts = { objectMode: true };
  const asyncParser = new AsyncParser(opts, transformOpts);

  let csv = '';
  asyncParser.processor
    .on('data', (chunk) => (csv += chunk.toString()))
    .on('end', () => {
      const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.style.display = 'none';
      link.setAttribute('href', url);
      link.setAttribute('download', 'demo-redhat-catalog.csv');
      document.body.appendChild(link);
      link.click();
    });
  catalogItems.forEach((ci) => asyncParser.input.push(ci));
  asyncParser.input.push(null);
}

function filterCatalogItemByAccessControl(catalogItem: CatalogItem, userGroups: string[]): boolean {
  return 'deny' !== checkAccessControl(catalogItem.spec.accessControl, userGroups);
}

function filterCatalogItemByCategory(catalogItem: CatalogItem, selectedCategory: string): boolean {
  return selectedCategory === getCategory(catalogItem);
}

function filterCatalogItemByKeywords(catalogItem: CatalogItem, keywordFilter: string[]): boolean {
  const ciCategory = getCategory(catalogItem);
  const ciDescription = catalogItem.metadata.annotations?.[`${BABYLON_DOMAIN}/description`];

  for (const keyword of keywordFilter) {
    const keywordLower = keyword.toLowerCase();

    let keywordMatch = null;

    if (
      catalogItem.metadata.name.toLowerCase().includes(keywordLower) ||
      displayName(catalogItem).toLowerCase().includes(keywordLower) ||
      (ciCategory && ciCategory.toLowerCase().includes(keywordLower)) ||
      (ciDescription && ciDescription.toLowerCase().includes(keywordLower))
    ) {
      keywordMatch = true;
    }

    if (!keywordMatch && catalogItem.metadata.labels) {
      for (const label in catalogItem.metadata.labels) {
        if (
          label.startsWith(`${BABYLON_DOMAIN}/`) &&
          catalogItem.metadata.labels[label].toLowerCase().includes(keywordLower)
        ) {
          keywordMatch = true;
          break;
        }
      }
    }

    if (!keywordMatch) {
      return false;
    }
  }
  return true;
}

function filterCatalogItemByLabels(catalogItem: CatalogItem, labelFilter: { [attr: string]: string[] }): boolean {
  for (const [attr, values] of Object.entries(labelFilter)) {
    const matchAttr = attr.toLowerCase();
    const matchValues = values.map((v) => v.toLowerCase());
    let matched = false;
    for (const [ciLabel, ciValue] of Object.entries(catalogItem.metadata.labels || {})) {
      if (ciLabel.startsWith(`${BABYLON_DOMAIN}/`)) {
        const ciAttr = ciLabel
          .substring(BABYLON_DOMAIN.length + 1)
          .replace(/-[0-9]+$/, '')
          .toLowerCase();
        if (matchAttr === ciAttr) {
          if (ciAttr === CUSTOM_LABELS.RATING) {
            if (parseInt(ciValue, 10) >= parseInt(matchValues[0], 10)) matched = true;
          } else if (matchValues.includes(ciValue.toLowerCase())) {
            matched = true;
          }
        }
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

function saveFilter(urlParams: URLSearchParams) {
  if (urlParams.has('item')) {
    urlParams.delete('item');
  }
  setLastFilter(urlParams.toString());
}

async function fetchCatalog(namespaces: string[]): Promise<CatalogItem[]> {
  async function fetchNamespace(namespace: string): Promise<CatalogItem[]> {
    return await fetcherItemsInAllPages((continueId) =>
      apiPaths.CATALOG_ITEMS({ namespace, limit: FETCH_BATCH_LIMIT, continueId })
    );
  }
  const catalogItems: CatalogItem[] = [];
  const namespacesPromises = [];
  for (const namespace of namespaces) {
    namespacesPromises.push(fetchNamespace(namespace).then((cis) => catalogItems.push(...cis)));
  }
  await Promise.all(namespacesPromises);
  return catalogItems;
}

const Catalog: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { namespace: catalogNamespaceName } = useParams();
  const { catalogNamespaces, groups, isAdmin } = useSession().getSession();
  const [view, setView] = useState<'gallery' | 'list'>('gallery');
  const [sortBy, setSortBy] = useState<{ isOpen: boolean; selected: 'Featured' | 'AZ' | 'ZA' }>({
    isOpen: false,
    selected: 'Featured',
  });
  const openCatalogItemParam = searchParams.has('item') ? searchParams.get('item') : null;
  const openCatalogItemNamespaceName = openCatalogItemParam
    ? openCatalogItemParam.includes('/')
      ? openCatalogItemParam.split('/')[0]
      : catalogNamespaceName
    : null;
  const openCatalogItemName = openCatalogItemParam
    ? openCatalogItemParam.includes('/')
      ? openCatalogItemParam.split('/')[1]
      : openCatalogItemParam
    : null;
  const keywordFilter = searchParams.has('search')
    ? searchParams
        .get('search')
        .trim()
        .split(/ +/)
        .filter((w) => w != '')
    : null;
  const selectedCategory = searchParams.has('category') ? searchParams.get('category') : null;
  const selectedLabels: { [label: string]: string[] } = searchParams.has('labels')
    ? JSON.parse(searchParams.get('labels'))
    : {};

  const catalogNamespaceNames = catalogNamespaces.map((ci) => ci.name);
  const requiredUserPropertiesToAccess =
    catalogNamespaces.length > 0 &&
    groups.some((g) => g.startsWith('identity-provider')) &&
    groups.some((g) => g.startsWith('email-domain'));

  useEffect(() => {
    if (!requiredUserPropertiesToAccess) {
      const count = searchParams.has('c') ? parseInt(searchParams.get('c'), 10) + 1 : 1;
      setTimeout(() => {
        if (count < 6) {
          const url = new URL(window.location.href);
          url.searchParams.set('c', count.toString());
          window.location.href = url.toString();
        }
      }, 10000);
    }
  }, [requiredUserPropertiesToAccess, searchParams]);
  const filterFunction = useMemo(() => (item: CatalogItem) => filterCatalogItemByAccessControl(item, groups), [groups]);

  const { data: catalogItemsArr } = useSWRImmutable<CatalogItem[]>(
    apiPaths.CATALOG_ITEMS({ namespace: catalogNamespaceName ? catalogNamespaceName : 'all-catalogs' }),
    () => fetchCatalog(catalogNamespaceName ? [catalogNamespaceName] : catalogNamespaceNames)
  );

  // Filter & Sort catalog items
  const catalogItems = useMemo(
    () => catalogItemsArr.filter(filterFunction).sort((a, b) => compareCatalogItems(a, b, sortBy.selected)),
    [catalogItemsArr, filterFunction, sortBy.selected]
  );

  // Load last filter
  useEffect(() => {
    const lastCatalogQuery = getLastFilter();
    if (!searchParams.toString() && lastCatalogQuery) {
      setSearchParams(lastCatalogQuery);
    }
  }, [searchParams, setSearchParams]);

  const categoryFilteredCatalogItems = selectedCategory
    ? catalogItems.filter((catalogItem) => filterCatalogItemByCategory(catalogItem, selectedCategory))
    : catalogItems;
  const searchFilteredCatalogItems = keywordFilter
    ? categoryFilteredCatalogItems.filter((catalogItem) => filterCatalogItemByKeywords(catalogItem, keywordFilter))
    : categoryFilteredCatalogItems;
  const labelFilteredCatalogItems = selectedLabels
    ? searchFilteredCatalogItems.filter((catalogItem) => filterCatalogItemByLabels(catalogItem, selectedLabels))
    : searchFilteredCatalogItems;

  const openCatalogItem =
    openCatalogItemName && openCatalogItemNamespaceName
      ? catalogItems.find(
          (item) =>
            item.metadata.name === openCatalogItemName && item.metadata.namespace === openCatalogItemNamespaceName
        )
      : null;

  function closeCatalogItem(): void {
    searchParams.delete('item');
    setSearchParams(searchParams);
  }

  function onKeywordSearchChange(value: string[]): void {
    if (value) {
      searchParams.set('search', value.join(' '));
    } else if (searchParams.has('search')) {
      searchParams.delete('search');
    }
    saveFilter(searchParams);
    setSearchParams(searchParams);
  }

  function onSelectCatalogNamespace(namespaceName: string | null): void {
    if (namespaceName) {
      navigate(`/catalog/${namespaceName}${location.search}`);
    } else {
      navigate(`/catalog${location.search}`);
    }
  }

  function onSelectCategory(category: string | null): void {
    if (category) {
      searchParams.set('category', category);
    } else if (searchParams.has('category')) {
      searchParams.delete('category');
    }
    saveFilter(searchParams);
    setSearchParams(searchParams);
  }

  function onSelectLabels(labels: { [label: string]: string[] } | null): void {
    if (labels) {
      searchParams.set('labels', JSON.stringify(labels));
    } else if (searchParams.has('labels')) {
      searchParams.delete('labels');
    }
    saveFilter(searchParams);
    setSearchParams(searchParams);
  }

  function onClearFilters() {
    saveFilter(new URLSearchParams());
    setSearchParams();
  }

  const getInitialKeywordFilter = () => {
    const lastCatalogQuery = getLastFilter();
    return keywordFilter
      ? keywordFilter
      : lastCatalogQuery && new URLSearchParams(lastCatalogQuery).has('search')
      ? [new URLSearchParams(lastCatalogQuery).get('search')]
      : null;
  };

  return (
    <Drawer isExpanded={openCatalogItem ? true : false}>
      <DrawerContent
        panelContent={
          openCatalogItem ? (
            <Suspense
              fallback={
                <DrawerPanelContent widths={{ default: 'width_75', lg: 'width_75', xl: 'width_66', '2xl': 'width_50' }}>
                  <PageSection variant={PageSectionVariants.light}>
                    <EmptyState variant="full">
                      <EmptyStateIcon icon={LoadingIcon} />
                    </EmptyState>
                  </PageSection>
                </DrawerPanelContent>
              }
            >
              <CatalogItemDetails catalogItem={openCatalogItem} onClose={closeCatalogItem} />
            </Suspense>
          ) : null
        }
      >
        {openCatalogItem ? <Backdrop /> : null}
        <DrawerContentBody>
          {catalogNamespaces.length > 1 ? (
            <CatalogNamespaceSelect onSelect={onSelectCatalogNamespace} selected={catalogNamespaceName} />
          ) : null}
          <CatalogInterfaceDescription />
          <PageSection className="catalog__body" variant={PageSectionVariants.light}>
            <Card>
              <CardBody>
                <Sidebar tabIndex={0}>
                  <SidebarPanel className="catalog__sidebar-panel">
                    <CatalogCategorySelector
                      catalogItems={catalogItems}
                      onSelect={onSelectCategory}
                      selected={selectedCategory}
                    />
                    <CatalogLabelSelector
                      catalogItems={catalogItems}
                      filteredCatalogItems={searchFilteredCatalogItems}
                      onSelect={onSelectLabels}
                      selected={selectedLabels}
                    />
                  </SidebarPanel>
                  <SidebarContent>
                    <PageSection variant={PageSectionVariants.light} className="catalog__header">
                      <Split>
                        <SplitItem isFilled>
                          <Title headingLevel="h2">
                            {selectedCategory ? formatString(selectedCategory) : 'All Items'}
                          </Title>
                          <KeywordSearchInput
                            initialValue={getInitialKeywordFilter()}
                            placeholder="Filter by keyword..."
                            onSearch={onKeywordSearchChange}
                            className="catalog__searchbox"
                          />
                        </SplitItem>
                        <SplitItem>
                          <Stack hasGutter>
                            <StackItem>
                              <ul className="catalog__right-tools">
                                <li>
                                  <Tooltip content="Gallery view">
                                    <Button
                                      variant="plain"
                                      aria-label="View as gallery"
                                      onClick={() => setView('gallery')}
                                      isActive={view === 'gallery'}
                                    >
                                      <ThIcon />
                                    </Button>
                                  </Tooltip>
                                </li>
                                <li>
                                  <Tooltip content="List view">
                                    <Button
                                      variant="plain"
                                      aria-label="View as list"
                                      onClick={() => setView('list')}
                                      isActive={view === 'list'}
                                    >
                                      <ListIcon />
                                    </Button>
                                  </Tooltip>
                                </li>
                                {isAdmin ? (
                                  <li>
                                    <Tooltip content="Export to CSV">
                                      <Button
                                        variant="plain"
                                        aria-label="Export to CSV"
                                        onClick={() => handleExportCsv(catalogItems)}
                                      >
                                        <DownloadIcon />
                                      </Button>
                                    </Tooltip>
                                  </li>
                                ) : null}
                                <li>
                                  <Select
                                    className="catalog__sort-by"
                                    variant={SelectVariant.single}
                                    aria-label="Sort by"
                                    onToggle={(isOpen) =>
                                      setSortBy({
                                        ...sortBy,
                                        isOpen,
                                      })
                                    }
                                    onSelect={(_, selection) =>
                                      setSortBy({
                                        ...sortBy,
                                        selected: selection as 'Featured' | 'AZ' | 'ZA',
                                        isOpen: false,
                                      })
                                    }
                                    selections={`Sort by: ${sortBy.selected}`}
                                    isOpen={sortBy.isOpen}
                                  >
                                    <SelectOption key={0} value="Featured" />
                                    <SelectOption key={1} value="AZ" />
                                    <SelectOption key={2} value="ZA" />
                                  </Select>
                                </li>
                              </ul>
                            </StackItem>
                            <StackItem>
                              <p className="catalog__item-count">
                                {labelFilteredCatalogItems.length} item{labelFilteredCatalogItems.length > 1 && 's'}
                              </p>
                            </StackItem>
                          </Stack>
                        </SplitItem>
                      </Split>
                    </PageSection>
                    {labelFilteredCatalogItems.length > 0 ? (
                      <PageSection
                        variant={PageSectionVariants.default}
                        className={`catalog__content-box catalog__content-box--${view}`}
                      >
                        {labelFilteredCatalogItems.map((catalogItem) =>
                          view === 'gallery' ? (
                            <CatalogItemCard key={catalogItem.metadata.uid} catalogItem={catalogItem} />
                          ) : (
                            <CatalogItemListItem key={catalogItem.metadata.uid} catalogItem={catalogItem} />
                          )
                        )}
                      </PageSection>
                    ) : (
                      <PageSection variant={PageSectionVariants.default} className="catalog__content-box--empty">
                        <EmptyState variant="full">
                          {catalogItems.length > 0 ? (
                            <p>
                              No catalog items match filters.{' '}
                              <Button
                                variant="primary"
                                aria-label="Clear all filters"
                                icon={<TimesIcon />}
                                style={{ marginLeft: 'var(--pf-global--spacer--sm)' }}
                                onClick={onClearFilters}
                              >
                                Clear all filters
                              </Button>
                            </p>
                          ) : groups.includes('salesforce-partner') ? (
                            <p>
                              Sorry! The new Red Hat Demo Platform (RHDP) is not yet available for partners. Please
                              continue to use <a href="https://labs.opentlc.com">labs.opentlc.com</a> for labs or{' '}
                              <a href="https://demo00.opentlc.com">demo00.opentlc.com</a> for demos.
                            </p>
                          ) : !requiredUserPropertiesToAccess ? (
                            <>
                              <p>Welcome to the Red Hat Demo Platform!</p>
                              <LoadingIcon />
                              <p>
                                Please wait a few seconds while we set up your catalog. If nothing happens refresh this
                                page.
                              </p>
                            </>
                          ) : (
                            <p>
                              Sorry! You do not have access to the Red Hat Demo Platform. This system is only available
                              for Red Hat associates at this time. Red Hat partners may access{' '}
                              <a href="https://labs.opentlc.com">labs.opentlc.com</a> for labs or{' '}
                              <a href="https://demo00.opentlc.com">demo00.opentlc.com</a> for demos.
                            </p>
                          )}
                        </EmptyState>
                      </PageSection>
                    )}
                  </SidebarContent>
                </Sidebar>
              </CardBody>
            </Card>
          </PageSection>
          <Footer />
        </DrawerContentBody>
      </DrawerContent>
    </Drawer>
  );
};

export default Catalog;
