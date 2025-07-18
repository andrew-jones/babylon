import React from 'react';
import { ActionDropdown, ActionDropdownItem } from '@app/components/ActionDropdown';
import { LockedIcon } from '@patternfly/react-icons';

const WorkshopActions: React.FC<{
  actionHandlers: {
    delete: () => void;
    restartService?: () => void | null;
    deleteService?: () => void | null;
    start?: () => void | null;
    stop?: () => void | null;
  };
  className?: string;
  isDisabled?: boolean;
  workshopName?: string;
  isLocked?: boolean;
}> = ({ actionHandlers, className, isDisabled, workshopName, isLocked = false }) => {
  const actionDropdownItems = [
    <ActionDropdownItem
      key="delete"
      isDisabled={isLocked || !actionHandlers.delete}
      label={workshopName ? `Delete ${workshopName}` : 'Delete'}
      onSelect={actionHandlers.delete}
      icon={isLocked ? <LockedIcon /> : null}
    />,
  ];
  actionHandlers.restartService &&
    actionDropdownItems.push(
      <ActionDropdownItem
        key="deleteServices"
        isDisabled={!actionHandlers.restartService}
        label="Redeploy Selected Services"
        onSelect={actionHandlers.restartService}
      />,
    );
  actionHandlers.deleteService &&
    actionDropdownItems.push(
      <ActionDropdownItem
        key="deleteServices"
        isDisabled={!actionHandlers.deleteService}
        label="Delete Selected Services"
        onSelect={actionHandlers.deleteService}
      />,
    );
  actionHandlers.start &&
    actionDropdownItems.push(
      <ActionDropdownItem
        key="startServices"
        isDisabled={!actionHandlers.start}
        label="Start Workshop instances"
        onSelect={actionHandlers.start}
      />,
    );
  actionHandlers.stop &&
    actionDropdownItems.push(
      <ActionDropdownItem
        key="stopServices"
        isDisabled={isLocked || !actionHandlers.stop}
        label="Stop Workshop instances"
        onSelect={actionHandlers.stop}
        icon={isLocked ? <LockedIcon /> : null}
      />,
    );

  return (
    <ActionDropdown
      position="right"
      actionDropdownItems={actionDropdownItems}
      className={className}
      isDisabled={isDisabled}
    />
  );
};

export default WorkshopActions;
