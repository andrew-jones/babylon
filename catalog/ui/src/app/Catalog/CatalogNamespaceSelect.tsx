import React, { useState } from 'react';
import { Dropdown, DropdownItem, DropdownToggle, PageSection, PageSectionVariants } from '@patternfly/react-core';
import useSession from '@app/utils/useSession';
import { displayName } from '@app/util';

import './catalog-namespace-select.css';

const CatalogNamespaceSelect: React.FC<{
  onSelect: (ns: string) => void;
  selected?: string;
}> = ({ onSelect, selected }) => {
  const { catalogNamespaces } = useSession().getSession();
  const selectedCatalogNamespace = catalogNamespaces.find((ns) => ns.name === selected);

  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <PageSection variant={PageSectionVariants.light} className="catalog-namespace-select">
      <Dropdown
        isPlain
        isOpen={isOpen}
        toggle={
          <DropdownToggle onToggle={() => setIsOpen((v) => !v)}>
            Catalog: {selected ? displayName(selectedCatalogNamespace) : 'all catalogs'}
          </DropdownToggle>
        }
        dropdownItems={[
          <DropdownItem
            key="*"
            onClick={() => {
              setIsOpen(false);
              onSelect(null);
            }}
          >
            - all catalogs -
          </DropdownItem>,
          ...catalogNamespaces.map((ns) => (
            <DropdownItem
              key={ns.name}
              onClick={() => {
                setIsOpen(false);
                onSelect(ns.name);
              }}
            >
              {displayName(ns)}
            </DropdownItem>
          )),
        ]}
      />
    </PageSection>
  );
};

export default CatalogNamespaceSelect;
