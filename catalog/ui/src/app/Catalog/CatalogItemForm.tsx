import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import parseDuration from 'parse-duration';
import { EditorState } from 'lexical/LexicalEditorState';
import { LexicalEditor } from 'lexical/LexicalEditor';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  ActionList,
  ActionListItem,
  Alert,
  AlertGroup,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Checkbox,
  Form,
  FormGroup,
  FormHelperText,
  PageSection,
  PageSectionVariants,
  Radio,
  Switch,
  TextInput,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import { Select, SelectOption, SelectList, MenuToggle, MenuToggleElement } from '@patternfly/react-core';
import OutlinedQuestionCircleIcon from '@patternfly/react-icons/dist/js/icons/outlined-question-circle-icon';
import useSWRImmutable from 'swr/immutable';
import {
  apiFetch,
  apiPaths,
  createServiceRequest,
  CreateServiceRequestParameterValues,
  createWorkshop,
  createWorkshopProvision,
  fetcher,
  saveExternalItemRequest,
} from '@app/api';
import { CatalogItem, TPurposeOpts } from '@app/types';
import { checkAccessControl, displayName, getStageFromK8sObject, isLabDeveloper, randomString } from '@app/util';
import Editor from '@app/components/Editor/Editor';
import useSession from '@app/utils/useSession';
import useDebounce from '@app/utils/useDebounce';
import PatientNumberInput from '@app/components/PatientNumberInput';
import DynamicFormInput from '@app/components/DynamicFormInput';
import ActivityPurposeSelector from '@app/components/ActivityPurposeSelector';
import ProjectSelector from '@app/components/ProjectSelector';
import TermsOfService from '@app/components/TermsOfService';
import { reduceFormState, checkEnableSubmit, checkConditionsInFormState } from './CatalogItemFormReducer';
import AutoStopDestroy from '@app/components/AutoStopDestroy';
import CatalogItemFormAutoStopDestroyModal, { TDates, TDatesTypes } from './CatalogItemFormAutoStopDestroyModal';
import { formatCurrency, getEstimatedCost, isAutoStopDisabled } from './catalog-utils';
import ErrorBoundaryPage from '@app/components/ErrorBoundaryPage';
import { SearchIcon } from '@patternfly/react-icons';
import SearchSalesforceIdModal from '@app/components/SearchSalesforceIdModal';
import useInterfaceConfig from '@app/utils/useInterfaceConfig';
import DateTimePicker from '@app/components/DateTimePicker';

import './catalog-item-form.css';

const CatalogItemFormData: React.FC<{ catalogItemName: string; catalogNamespaceName: string }> = ({
  catalogItemName,
  catalogNamespaceName,
}) => {
  const navigate = useNavigate();
  const debouncedApiFetch = useDebounce(apiFetch, 1000);
  const [autoStopDestroyModal, openAutoStopDestroyModal] = useState<TDatesTypes>(null);
  const [searchSalesforceIdModal, openSearchSalesforceIdModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { isAdmin, groups, roles, serviceNamespaces, userNamespace, email } = useSession().getSession();
  const { sfdc_enabled } = useInterfaceConfig();
  const { data: catalogItem } = useSWRImmutable<CatalogItem>(
    apiPaths.CATALOG_ITEM({ namespace: catalogNamespaceName, name: catalogItemName }),
    fetcher,
  );

  const _displayName = displayName(catalogItem);
  const estimatedCost = useMemo(() => getEstimatedCost(catalogItem), []);
  const [userRegistrationSelectIsOpen, setUserRegistrationSelectIsOpen] = useState(false);
  const workshopInitialProps = useMemo(
    () => ({
      userRegistration: 'open',
      accessPassword: randomString(8),
      description: '<p></p>',
      displayName: _displayName,
      provisionCount: 1,
      provisionConcurrency: catalogItem.spec.multiuser ? 1 : 10,
      provisionStartDelay: 30,
    }),
    [catalogItem],
  );

  const onToggleClick = () => {
    setUserRegistrationSelectIsOpen(!userRegistrationSelectIsOpen);
  };

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle ref={toggleRef} onClick={onToggleClick} isExpanded={userRegistrationSelectIsOpen}>
      {formState.workshop.userRegistration}
    </MenuToggle>
  );

  const purposeOpts: TPurposeOpts = catalogItem.spec.parameters
    ? catalogItem.spec.parameters.find((p) => p.name === 'purpose')?.openAPIV3Schema['x-form-options'] || []
    : [];
  const workshopUiDisabled = catalogItem.spec.workshopUiDisabled || false;
  const [formState, dispatchFormState] = useReducer(
    reduceFormState,
    reduceFormState(null, {
      type: 'init',
      catalogItem,
      serviceNamespace: userNamespace,
      user: { groups, roles, isAdmin },
      purposeOpts,
      sfdc_enabled,
    }),
  );
  let maxAutoDestroyTime = Math.min(
    parseDuration(catalogItem.spec.lifespan?.maximum),
    parseDuration(catalogItem.spec.lifespan?.relativeMaximum),
  );
  let maxAutoStopTime = parseDuration(catalogItem.spec.runtime?.maximum);
  if (formState.parameters['open_environment']?.value === true) {
    maxAutoDestroyTime = parseDuration('365d');
    maxAutoStopTime = maxAutoDestroyTime;
  }
  const purposeObj =
    purposeOpts.length > 0 ? purposeOpts.find((p) => formState.purpose && formState.purpose.startsWith(p.name)) : null;
  const submitRequestEnabled = checkEnableSubmit(formState) && !isLoading;

  useEffect(() => {
    if (!formState.conditionChecks.completed) {
      checkConditionsInFormState(formState, dispatchFormState, debouncedApiFetch);
    }
  }, [dispatchFormState, formState, debouncedApiFetch]);

  async function submitRequest(): Promise<void> {
    if (!submitRequestEnabled) {
      throw new Error('submitRequest called when submission should be disabled!');
    }
    if (isLoading) {
      return null;
    }
    setIsLoading(true);
    const parameterValues: CreateServiceRequestParameterValues = {};
    for (const parameterState of Object.values(formState.parameters)) {
      // Add parameters for request that have values and are not disabled or hidden
      if (
        parameterState.value !== undefined &&
        !parameterState.isDisabled &&
        !parameterState.isHidden &&
        !(parameterState.value === '' && !parameterState.isRequired)
      ) {
        parameterValues[parameterState.name] = parameterState.value;
      }
    }
    parameterValues['purpose'] = formState.purpose;
    parameterValues['purpose_activity'] = formState.activity;
    parameterValues['purpose_explanation'] = formState.explanation;
    if (formState.salesforceId.value) {
      parameterValues['salesforce_id'] = formState.salesforceId.value;
      parameterValues['sales_type'] = formState.salesforceId.type;
    }

    if (catalogItem.spec.externalUrl) {
      await saveExternalItemRequest({
        asset_uuid: catalogItem.metadata.labels['gpte.redhat.com/asset-uuid'],
        requester: formState.serviceNamespace.requester || email,
        purpose: formState.purpose,
        purposeActivity: formState.activity,
        purposeExplanation: formState.explanation,
        salesforceId: formState.salesforceId?.value,
        salesType: formState.salesforceId?.type,
        stage: getStageFromK8sObject(catalogItem),
      });
      setIsLoading(false);
      window.open(catalogItem.spec.externalUrl, '_blank');
      return null;
    }

    if (formState.workshop) {
      const {
        accessPassword,
        description,
        displayName,
        userRegistration,
        provisionConcurrency,
        provisionCount,
        provisionStartDelay,
      } = formState.workshop;
      const workshop = await createWorkshop({
        accessPassword,
        description,
        displayName,
        catalogItem: catalogItem,
        openRegistration: userRegistration === 'open',
        serviceNamespace: formState.serviceNamespace,
        stopDate: formState.stopDate,
        endDate: formState.endDate,
        startDate: formState.startDate,
        email,
        parameterValues,
        skippedSfdc: formState.salesforceId.skip,
        whiteGloved: formState.whiteGloved,
      });
      const redirectUrl = `/workshops/${workshop.metadata.namespace}/${workshop.metadata.name}`;
      await createWorkshopProvision({
        catalogItem: catalogItem,
        concurrency: provisionConcurrency,
        count: provisionCount,
        parameters: parameterValues,
        startDelay: provisionStartDelay,
        workshop: workshop,
        useAutoDetach: formState.useAutoDetach,
        usePoolIfAvailable: formState.usePoolIfAvailable,
      });
      navigate(redirectUrl);
    } else {
      const resourceClaim = await createServiceRequest({
        catalogItem,
        catalogNamespaceName: catalogNamespaceName,
        groups,
        isAdmin,
        parameterValues,
        serviceNamespace: formState.serviceNamespace,
        usePoolIfAvailable: formState.usePoolIfAvailable,
        useAutoDetach: formState.useAutoDetach,
        startDate: formState.startDate,
        stopDate: formState.stopDate,
        endDate: formState.endDate,
        email,
        skippedSfdc: formState.salesforceId.skip,
        whiteGloved: formState.whiteGloved,
      });

      navigate(`/services/${resourceClaim.metadata.namespace}/${resourceClaim.metadata.name}`);
    }
    setIsLoading(false);
  }

  if ('deny' === checkAccessControl(catalogItem.spec.accessControl, groups, isAdmin)) {
    return <Navigate to="/" replace />;
  }

  return (
    <PageSection variant={PageSectionVariants.light} className="catalog-item-form">
      <CatalogItemFormAutoStopDestroyModal
        type={autoStopDestroyModal}
        autoStopDate={formState.stopDate}
        autoDestroyDate={formState.endDate}
        isAutoStopDisabled={isAutoStopDisabled(catalogItem)}
        maxRuntimeTimestamp={isAdmin ? maxAutoDestroyTime : maxAutoStopTime}
        defaultRuntimeTimestamp={
          new Date(Date.now() + parseDuration(catalogItem.spec.runtime?.default)) > formState.endDate
            ? parseDuration('4h')
            : parseDuration(catalogItem.spec.runtime?.default)
        }
        maxDestroyTimestamp={
          isAdmin
            ? null
            : formState.workshop
              ? formState.startDate.getTime() - Date.now() + parseDuration('5d')
              : maxAutoDestroyTime
        }
        onConfirm={(dates: TDates) =>
          autoStopDestroyModal === 'auto-destroy'
            ? dispatchFormState({ type: 'dates', endDate: dates.endDate })
            : autoStopDestroyModal === 'auto-stop'
              ? dispatchFormState({ type: 'dates', stopDate: dates.stopDate })
              : null
        }
        onClose={() => openAutoStopDestroyModal(null)}
        title={_displayName}
      />
      <SearchSalesforceIdModal
        isOpen={searchSalesforceIdModal}
        onClose={() => openSearchSalesforceIdModal(false)}
        defaultSfdcType={formState.salesforceId.type || null}
        onSubmitCb={(value: string, type: 'campaign' | 'project' | 'opportunity') =>
          dispatchFormState({
            type: 'salesforceId',
            salesforceId: {
              ...formState.salesforceId,
              value,
              type,
              valid: false,
            },
          })
        }
      />
      <Breadcrumb>
        <BreadcrumbItem
          render={({ className }) => (
            <Link to="/catalog" className={className}>
              Catalog
            </Link>
          )}
        />
        <BreadcrumbItem
          render={({ className }) => (
            <Link
              to={`/catalog?item=${catalogItem.metadata.namespace}/${catalogItem.metadata.name}`}
              className={className}
            >
              {_displayName}
            </Link>
          )}
        />
      </Breadcrumb>
      <Title headingLevel="h1" size="lg">
        Order {_displayName}
      </Title>
      <p>Order by completing the form. Default values may be provided.</p>
      {formState.error ? <p className="error">{formState.error}</p> : null}
      <Form className="catalog-item-form__form">
        {(isAdmin || serviceNamespaces.length > 1) && !catalogItem.spec.externalUrl ? (
          <FormGroup key="service-namespace" fieldId="service-namespace" label="Create Request in Project">
            <ProjectSelector
              currentNamespaceName={formState.serviceNamespace.name}
              onSelect={(namespace) => {
                dispatchFormState({
                  type: 'serviceNamespace',
                  serviceNamespace: namespace,
                });
              }}
              isPlain={false}
              hideLabel={true}
            />
            <Tooltip position="right" content={<div>Create service request in specified project namespace.</div>}>
              <OutlinedQuestionCircleIcon
                aria-label="Create service request in specified project namespace."
                className="tooltip-icon-only"
                style={{ marginLeft: 'var(--pf-v5-global--spacer--md)' }}
              />
            </Tooltip>
          </FormGroup>
        ) : null}

        {purposeOpts.length > 0 ? (
          <>
            <ActivityPurposeSelector
              value={{ purpose: formState.purpose, activity: formState.activity }}
              purposeOpts={purposeOpts}
              onChange={(activity: string, purpose: string, explanation: string) => {
                dispatchFormState({
                  type: 'purpose',
                  activity,
                  purpose,
                  explanation,
                });
              }}
              style={purposeOpts.length === 1 ? { display: 'none' } : {}}
            />

            {sfdc_enabled ? (
              <FormGroup
                fieldId="salesforce_id"
                style={purposeOpts.length === 1 && formState.salesforceId.required === false ? { display: 'none' } : {}}
                isRequired={formState.salesforceId.required && !formState.salesforceId.skip}
                label={
                  <span>
                    Salesforce ID{' '}
                    <span
                      style={{
                        fontSize: 'var(--pf-v5-global--FontSize--xs)',
                        color: 'var(--pf-v5-global--palette--black-600)',
                        fontStyle: 'italic',
                        fontWeight: 400,
                      }}
                    >
                      (Opportunity ID, Campaign ID or Project ID)
                    </span>
                  </span>
                }
              >
                <div>
                  <div className="catalog-item-form__group-control--single" style={{ paddingBottom: '16px' }}>
                    <Radio
                      isChecked={'campaign' === formState.salesforceId.type}
                      name="sfdc-type"
                      onChange={() => {
                        dispatchFormState({
                          type: 'salesforceId',
                          salesforceId: {
                            ...formState.salesforceId,
                            value: formState.salesforceId.value,
                            type: 'campaign',
                            valid: false,
                          },
                        });
                      }}
                      label="Campaign"
                      id="sfdc-type-campaign"
                    ></Radio>
                    <Radio
                      isChecked={'opportunity' === formState.salesforceId.type}
                      name="sfdc-type"
                      onChange={() => {
                        dispatchFormState({
                          type: 'salesforceId',
                          salesforceId: {
                            ...formState.salesforceId,
                            value: formState.salesforceId.value,
                            type: 'opportunity',
                            valid: false,
                          },
                        });
                      }}
                      label="Opportunity"
                      id="sfdc-type-opportunity"
                    ></Radio>
                    <Radio
                      isChecked={'project' === formState.salesforceId.type}
                      name="sfdc-type"
                      onChange={() => {
                        dispatchFormState({
                          type: 'salesforceId',
                          salesforceId: {
                            ...formState.salesforceId,
                            value: formState.salesforceId.value,
                            type: 'project',
                            valid: false,
                          },
                        });
                      }}
                      label="Project"
                      id="sfdc-type-project"
                    ></Radio>
                    <Tooltip
                      position="right"
                      content={<div>Salesforce ID type: Opportunity ID, Campaign ID or Project ID.</div>}
                    >
                      <OutlinedQuestionCircleIcon
                        aria-label="Salesforce ID type: Opportunity ID, Campaign ID or Project ID."
                        className="tooltip-icon-only"
                      />
                    </Tooltip>
                  </div>
                  <div className="catalog-item-form__group-control--single">
                    <TextInput
                      type="text"
                      key="salesforce_id"
                      id="salesforce_id"
                      onChange={(_event, value) =>
                        dispatchFormState({
                          type: 'salesforceId',
                          salesforceId: { ...formState.salesforceId, value, valid: false },
                        })
                      }
                      placeholder="Salesforce ID"
                      value={formState.salesforceId.value || ''}
                      validated={
                        formState.salesforceId.value && formState.salesforceId.valid
                          ? 'success'
                          : formState.salesforceId.value && formState.conditionChecks.completed
                            ? 'error'
                            : 'default'
                      }
                    />
                    <div>
                      <Button
                        onClick={() => openSearchSalesforceIdModal(true)}
                        variant="secondary"
                        icon={<SearchIcon />}
                      >
                        Search
                      </Button>
                    </div>
                    <Tooltip
                      position="right"
                      content={<div>Salesforce Opportunity ID, Campaign ID or Project ID.</div>}
                    >
                      <OutlinedQuestionCircleIcon
                        aria-label="Salesforce Opportunity ID, Campaign ID or Project ID."
                        className="tooltip-icon-only"
                      />
                    </Tooltip>
                  </div>
                  {!formState.salesforceId.valid && formState.conditionChecks.completed ? (
                    <FormHelperText>{formState.salesforceId.message}</FormHelperText>
                  ) : purposeObj && purposeObj.sfdcRequired ? (
                    <FormHelperText>
                      A valid Salesforce ID is required for the selected activity / purpose
                    </FormHelperText>
                  ) : null}
                  <div>
                    <div className="catalog-item-form__group-control--single" style={{ paddingTop: '16px' }}>
                      <Checkbox
                        id="skip-salesforce-id"
                        name="skip-salesforce-id"
                        label="I'll provide the Salesforce ID within 48 hours."
                        isChecked={formState.salesforceId.skip}
                        onChange={(_event: any, checked: boolean) =>
                          dispatchFormState({
                            type: 'salesforceId',
                            salesforceId: {
                              ...formState.salesforceId,
                              value: formState.salesforceId.value,
                              skip: checked,
                            },
                          })
                        }
                      />
                      <Tooltip
                        position="right"
                        content={
                          <div>
                            By checking this box, you agree to provide the required number within 48 hours, in alignment
                            with Red Hat's Code of Ethics. It is your responsibility to ensure the accuracy and timely
                            submission of this information, as it is essential for the integrity and compliance of our
                            processes.
                          </div>
                        }
                      >
                        <OutlinedQuestionCircleIcon
                          aria-label="By checking this box, you agree to provide the required number within 48 hours, in alignment with Red Hat's Code of Ethics. It is your responsibility to ensure the accuracy and timely submission of this information, as it is essential for the integrity and compliance of our processes."
                          className="tooltip-icon-only"
                        />
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </FormGroup>
            ) : null}
          </>
        ) : null}
        {formState.formGroups.map((formGroup, formGroupIdx) => {
          // do not render form group if all parameters for formGroup are hidden
          if (formGroup.parameters.every((parameter) => parameter.isHidden)) {
            return null;
          }
          // check if there is an invalid parameter in the form group
          const invalidParameter = formGroup.parameters.find(
            (parameter) =>
              !parameter.isDisabled && (parameter.isValid === false || parameter.validationResult === false),
          );

          return (
            <FormGroup
              key={formGroup.key}
              fieldId={formGroup.parameters.length === 1 ? `${formGroup.key}-${formGroupIdx}` : null}
              isRequired={formGroup.isRequired}
              label={formGroup.formGroupLabel}
            >
              {formGroup.parameters
                ? formGroup.parameters
                    .filter((p) => !p.isHidden)
                    .map((parameterState) => (
                      <div
                        className={`catalog-item-form__group-control--${
                          formGroup.parameters.length > 1 ? 'multi' : 'single'
                        }`}
                        key={parameterState.spec.name}
                      >
                        <DynamicFormInput
                          id={formGroup.parameters.length === 1 ? `${formGroup.key}-${formGroupIdx}` : null}
                          isDisabled={parameterState.isDisabled}
                          parameter={parameterState.spec}
                          validationResult={parameterState.validationResult}
                          value={parameterState.value}
                          onChange={(value: boolean | number | string, isValid = true) => {
                            dispatchFormState({
                              type: 'parameterUpdate',
                              parameter: { name: parameterState.spec.name, value, isValid },
                            });
                          }}
                        />
                        {parameterState.spec.description ? (
                          <Tooltip position="right" content={<div>{parameterState.spec.description}</div>}>
                            <OutlinedQuestionCircleIcon
                              aria-label={parameterState.spec.description}
                              className="tooltip-icon-only"
                            />
                          </Tooltip>
                        ) : null}
                      </div>
                    ))
                : null}
              {invalidParameter?.validationMessage ? (
                <FormHelperText>{invalidParameter.validationMessage}</FormHelperText>
              ) : null}
            </FormGroup>
          );
        })}

        {!workshopUiDisabled && !catalogItem.spec.externalUrl ? (
          <FormGroup key="workshop-switch" fieldId="workshop-switch">
            <div className="catalog-item-form__group-control--single">
              <Switch
                id="workshop-switch"
                aria-label="Enable workshop user interface"
                label={
                  <span style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                    Enable workshop user interface{' '}
                    <span
                      style={{
                        backgroundColor: '#faeae8',
                        borderRadius: '10px',
                        color: '#7d1007',
                        fontStyle: 'italic',
                        fontWeight: 300,
                        fontSize: '12px',
                        padding: '0 8px',
                        marginLeft: '8px',
                      }}
                    >
                      Beta
                    </span>
                  </span>
                }
                isChecked={!!formState.workshop}
                hasCheckIcon
                onChange={(_event, isChecked) => {
                  dispatchFormState({
                    type: 'workshop',
                    workshop: isChecked ? workshopInitialProps : null,
                  });
                  if (!formState.startDate) {
                    dispatchFormState({
                      type: 'dates',
                      startDate: new Date(),
                    });
                  }
                }}
              />
              <Tooltip
                position="right"
                isContentLeftAligned
                content={
                  catalogItem.spec.multiuser ? (
                    <p>Setup a user interface for the workshop attendees to access their credentials.</p>
                  ) : (
                    <ul>
                      <li>- Provision independent services for each attendee in the workshop.</li>
                      <li>- Setup a user interface for the workshop attendees to access their credentials.</li>
                    </ul>
                  )
                }
              >
                <OutlinedQuestionCircleIcon
                  aria-label="Setup a user interface for the attendees to access their credentials"
                  className="tooltip-icon-only"
                />
              </Tooltip>
            </div>
          </FormGroup>
        ) : null}

        {!formState.workshop && !catalogItem.spec.externalUrl ? (
          <FormGroup fieldId="serviceStartDate" isRequired label="Start Provisioning Date">
            <div className="catalog-item-form__group-control--single">
              <DateTimePicker
                defaultTimestamp={Date.now()}
                onSelect={(d: Date) =>
                  dispatchFormState({
                    type: 'initDates',
                    catalogItem,
                    startDate: d,
                  })
                }
                minDate={Date.now()}
              />
              <Tooltip position="right" content={<p>Select the date you'd like the service to start provisioning.</p>}>
                <OutlinedQuestionCircleIcon
                  aria-label="Select the date you'd like the service to start provisioning."
                  className="tooltip-icon-only"
                />
              </Tooltip>
            </div>
          </FormGroup>
        ) : null}

        {!isAutoStopDisabled(catalogItem) && !formState.workshop && !catalogItem.spec.externalUrl ? (
          <FormGroup key="auto-stop" fieldId="auto-stop" label="Auto-stop">
            <div className="catalog-item-form__group-control--single">
              <AutoStopDestroy
                type="auto-stop"
                onClick={() => openAutoStopDestroyModal('auto-stop')}
                className="catalog-item-form__auto-stop-btn"
                time={formState.stopDate ? formState.stopDate.getTime() : null}
                variant="extended"
                destroyTimestamp={formState.endDate.getTime()}
              />
            </div>
          </FormGroup>
        ) : null}

        {!formState.workshop && !catalogItem.spec.externalUrl ? (
          <FormGroup key="auto-destroy" fieldId="auto-destroy" label="Auto-destroy">
            <div className="catalog-item-form__group-control--single">
              <AutoStopDestroy
                type="auto-destroy"
                onClick={() => openAutoStopDestroyModal('auto-destroy')}
                className="catalog-item-form__auto-destroy-btn"
                time={formState.endDate.getTime()}
                variant="extended"
                destroyTimestamp={formState.endDate.getTime()}
              />
            </div>
          </FormGroup>
        ) : null}

        {formState.workshop ? (
          <div className="catalog-item-form__workshop-form">
            <FormGroup fieldId="workshopStartProvisioningDate" isRequired label="Start Provisioning Date">
              <div className="catalog-item-form__group-control--single">
                <DateTimePicker
                  defaultTimestamp={Date.now()}
                  onSelect={(d: Date) =>
                    dispatchFormState({
                      type: 'dates',
                      startDate: d,
                      stopDate: new Date(
                        d.getTime() +
                          parseDuration(
                            formState.activity?.startsWith('Customer Facing')
                              ? '365d'
                              : catalogItem.spec.runtime?.default || '30h',
                          ),
                      ),
                      endDate: new Date(d.getTime() + parseDuration('30h')),
                    })
                  }
                  minDate={Date.now()}
                />
                <Tooltip
                  position="right"
                  content={<p>Select the date you'd like the workshop to start provisioning.</p>}
                >
                  <OutlinedQuestionCircleIcon
                    aria-label="Select the date you'd like the workshop to start provisioning."
                    className="tooltip-icon-only"
                  />
                </Tooltip>
              </div>
            </FormGroup>
            {!isAutoStopDisabled(catalogItem) ? (
              <FormGroup key="auto-stop" fieldId="auto-stop" isRequired label="Auto-stop">
                <div className="catalog-item-form__group-control--single">
                  <AutoStopDestroy
                    type="auto-stop"
                    onClick={() => openAutoStopDestroyModal('auto-stop')}
                    className="catalog-item-form__auto-stop-btn"
                    time={formState.stopDate.getTime()}
                    variant="extended"
                    destroyTimestamp={formState.endDate.getTime()}
                  />
                </div>
              </FormGroup>
            ) : null}
            <FormGroup key="auto-destroy" fieldId="auto-destroy" label="Auto-destroy">
              <div className="catalog-item-form__group-control--single">
                <AutoStopDestroy
                  type="auto-destroy"
                  onClick={() => openAutoStopDestroyModal('auto-destroy')}
                  className="catalog-item-form__auto-destroy-btn"
                  time={formState.endDate.getTime()}
                  variant="extended"
                  destroyTimestamp={formState.endDate.getTime()}
                />
              </div>
            </FormGroup>
            <FormGroup fieldId="workshopDisplayName" isRequired label="Display Name">
              <div className="catalog-item-form__group-control--single">
                <TextInput
                  id="workshopDisplayName"
                  onChange={(_event, v) =>
                    dispatchFormState({ type: 'workshop', workshop: { ...formState.workshop, displayName: v } })
                  }
                  value={formState.workshop.displayName}
                />
                <Tooltip position="right" content={<p>Title shown in the workshop user interface.</p>}>
                  <OutlinedQuestionCircleIcon
                    aria-label="Title shown in the workshop user interface"
                    className="tooltip-icon-only"
                  />
                </Tooltip>
              </div>
            </FormGroup>
            <FormGroup fieldId="workshopAccessPassword" label="Password">
              <div className="catalog-item-form__group-control--single">
                <TextInput
                  id="workshopAccessPassword"
                  onChange={(_event, v) =>
                    dispatchFormState({ type: 'workshop', workshop: { ...formState.workshop, accessPassword: v } })
                  }
                  value={formState.workshop.accessPassword}
                />
                <Tooltip
                  position="right"
                  content={<p>Password to access credentials, if left empty no password will be required.</p>}
                >
                  <OutlinedQuestionCircleIcon
                    aria-label="Password to access credentials, if left empty no password will be required"
                    className="tooltip-icon-only"
                  />
                </Tooltip>
              </div>
            </FormGroup>
            <FormGroup fieldId="workshopRegistration" label="User Registration" className="select-wrapper">
              <div className="catalog-item-form__group-control--single">
                <Select
                  isOpen={userRegistrationSelectIsOpen}
                  onSelect={(_, selected) => {
                    dispatchFormState({
                      type: 'workshop',
                      workshop: {
                        ...formState.workshop,
                        userRegistration: typeof selected === 'string' ? selected : selected.toString(),
                      },
                    });
                    setUserRegistrationSelectIsOpen(false);
                  }}
                  selected={formState.workshop.userRegistration}
                  onOpenChange={(isOpen) => setUserRegistrationSelectIsOpen(isOpen)}
                  toggle={toggle}
                >
                  <SelectList>
                    <SelectOption value="open">open registration</SelectOption>
                    <SelectOption value="pre">pre-registration</SelectOption>
                  </SelectList>
                </Select>
                <Tooltip
                  position="right"
                  isContentLeftAligned
                  content={
                    <ul>
                      <li>- Open registration: Only the password will be required to access the credentials.</li>
                      <li>
                        - Pre-registration: Emails need to be provided before the attendees can access their
                        credentials, an email and password will be required to access the credentials.
                      </li>
                    </ul>
                  }
                >
                  <OutlinedQuestionCircleIcon aria-label="Type of registration" className="tooltip-icon-only" />
                </Tooltip>
              </div>
            </FormGroup>
            <FormGroup fieldId="workshopDescription" label="Description">
              <div className="catalog-item-form__group-control--single">
                <Editor
                  onChange={(_: EditorState, editor: LexicalEditor) => {
                    editor.update(() => {
                      const html = $generateHtmlFromNodes(editor, null);
                      dispatchFormState({
                        type: 'workshop',
                        workshop: { ...formState.workshop, description: html },
                      });
                    });
                  }}
                  placeholder="Add description"
                  aria-label="Description"
                  defaultValue={formState.workshop.description}
                />
                <Tooltip position="right" content={<p>Description text visible in the user access page.</p>}>
                  <OutlinedQuestionCircleIcon
                    aria-label="Description text visible in the user access page."
                    className="tooltip-icon-only"
                  />
                </Tooltip>
              </div>
            </FormGroup>
            {catalogItem.spec.multiuser ? null : (
              <>
                <FormGroup key="provisionCount" fieldId="workshopProvisionCount" label="Workshop User Count">
                  <div className="catalog-item-form__group-control--single">
                    <PatientNumberInput
                      min={0}
                      max={catalogItem.spec.workshopUiMaxInstances || 30}
                      adminModifier={true}
                      onChange={(v) =>
                        dispatchFormState({ type: 'workshop', workshop: { ...formState.workshop, provisionCount: v } })
                      }
                      value={formState.workshop.provisionCount}
                    />
                    <Tooltip position="right" content={<p>Number of independent services for the workshop.</p>}>
                      <OutlinedQuestionCircleIcon
                        aria-label="Number of independent services for the workshop"
                        className="tooltip-icon-only"
                      />
                    </Tooltip>
                  </div>
                  {estimatedCost && formState.workshop.provisionCount > 1 ? (
                    <AlertGroup style={{ marginTop: 'var(--pf-v5-global--spacer--sm)' }}>
                      <Alert
                        title={
                          <p>
                            Estimated hourly cost for this workshop user count:{' '}
                            <b>{formatCurrency(formState.workshop.provisionCount * estimatedCost)}</b>
                          </p>
                        }
                        variant="info"
                        isInline
                      />
                    </AlertGroup>
                  ) : null}
                </FormGroup>
                {isAdmin ? (
                  <>
                    <FormGroup
                      key="provisionConcurrency"
                      fieldId="workshopProvisionConcurrency"
                      label="Provision Concurrency (only visible to admins)"
                    >
                      <div className="catalog-item-form__group-control--single">
                        <PatientNumberInput
                          min={1}
                          max={30}
                          onChange={(v) =>
                            dispatchFormState({
                              type: 'workshop',
                              workshop: { ...formState.workshop, provisionConcurrency: v },
                            })
                          }
                          value={formState.workshop.provisionConcurrency}
                        />
                      </div>
                    </FormGroup>
                    <FormGroup
                      key="provisionStartDelay"
                      fieldId="workshopProvisionStartDelay"
                      label="Provision Start Interval (only visible to admins)"
                    >
                      <div className="catalog-item-form__group-control--single">
                        <PatientNumberInput
                          min={15}
                          max={600}
                          onChange={(v) =>
                            dispatchFormState({
                              type: 'workshop',
                              workshop: { ...formState.workshop, provisionStartDelay: v },
                            })
                          }
                          value={formState.workshop.provisionStartDelay}
                        />
                      </div>
                    </FormGroup>
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {isAdmin && !catalogItem.spec.externalUrl ? (
          <FormGroup fieldId="white-glove" isRequired>
            <div className="catalog-item-form__group-control--single">
              <Switch
                id="white-glove-switch"
                aria-label="White-Glove Support"
                label="White-Glove Support (for admins to tick when giving a white gloved experience)"
                isChecked={formState.whiteGloved}
                hasCheckIcon
                onChange={(_event, isChecked) => {
                  dispatchFormState({
                    type: 'whiteGloved',
                    whiteGloved: isChecked,
                  });
                }}
              />
            </div>
          </FormGroup>
        ) : null}

        {isAdmin && !catalogItem.spec.externalUrl ? (
          <FormGroup key="pooling-switch" fieldId="pooling-switch">
            <div className="catalog-item-form__group-control--single">
              <Switch
                id="pooling-switch"
                aria-label="Use pool if available"
                label="Use pool if available (only visible to admins)"
                isChecked={formState.usePoolIfAvailable}
                hasCheckIcon
                onChange={(_event, isChecked) =>
                  dispatchFormState({
                    type: 'usePoolIfAvailable',
                    usePoolIfAvailable: isChecked,
                  })
                }
              />
            </div>
          </FormGroup>
        ) : null}

        {(isAdmin || isLabDeveloper(groups)) && !catalogItem.spec.externalUrl ? (
          <FormGroup key="auto-detach-switch" fieldId="auto-detach-switch">
            <div className="catalog-item-form__group-control--single">
              <Switch
                id="auto-detach-switch"
                aria-label="Keep instance if provision fails"
                label="Keep instance if provision fails (only visible to admins)"
                isChecked={!formState.useAutoDetach}
                hasCheckIcon
                onChange={(_event, isChecked) => {
                  dispatchFormState({
                    type: 'useAutoDetach',
                    useAutoDetach: !isChecked,
                  });
                }}
              />
            </div>
          </FormGroup>
        ) : null}

        {catalogItem.spec.termsOfService ? (
          <TermsOfService
            agreed={formState.termsOfServiceAgreed}
            onChange={(ev, agreed) => {
              dispatchFormState({
                type: 'termsOfServiceAgreed',
                termsOfServiceAgreed: agreed,
              });
            }}
            text={catalogItem.spec.termsOfService}
          />
        ) : null}

        <ActionList>
          <ActionListItem>
            <Button
              isAriaDisabled={!submitRequestEnabled}
              isDisabled={!submitRequestEnabled}
              onClick={() => submitRequest()}
            >
              Order
            </Button>
          </ActionListItem>

          <ActionListItem>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </ActionListItem>
        </ActionList>
      </Form>
    </PageSection>
  );
};

const CatalogItemForm: React.FC = () => {
  const { namespace: catalogNamespaceName, name: catalogItemName } = useParams();
  return (
    <ErrorBoundaryPage namespace={catalogNamespaceName} name={catalogItemName} type="Catalog item">
      <CatalogItemFormData catalogItemName={catalogItemName} catalogNamespaceName={catalogNamespaceName} />
    </ErrorBoundaryPage>
  );
};

export default CatalogItemForm;
