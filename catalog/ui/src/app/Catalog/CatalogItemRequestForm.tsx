import React from 'react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';

import {
  ActionList,
  ActionListItem,
  Button,
  EmptyState,
  EmptyStateIcon,
  Form,
  FormGroup,
  FormHelperText,
  PageSection,
  PageSectionVariants,
  Title,
} from '@patternfly/react-core';
import {
  ExclamationCircleIcon,
} from '@patternfly/react-icons';

import {
  checkSalesforceId,
  createServiceRequest,
  CreateServiceRequestParameterValues,
} from '@app/api';
import { selectCatalogNamespace, selectUserIsAdmin } from '@app/store';
import {
  CatalogItem,
  CatalogItemSpecParameter,
  CatalogNamespace,
  ResourceClaim
} from '@app/types';
import {
  ConditionValues,
  checkAccessControl,
  checkCondition,
  displayName
} from '@app/util';

import DynamicFormInput from '@app/components/DynamicFormInput';
import LoadingIcon from '@app/components/LoadingIcon';
import TermsOfService from '@app/components/TermsOfService';

import './catalog-request.css';

interface FormState {
  conditionChecks: {
    canceled: boolean;
    complete: boolean;
    running: boolean;
  };
  formGroups: FormStateParameterGroup[];
  initComplete: boolean;
  parameters: {[name: string]: FormStateParameter};
  termsOfServiceAgreed: boolean;
  termsOfServiceRequired: boolean;
}

interface FormStateAction {
  type: "checkConditionsComplete" | "init" | "parameterUpdate" | "termsOfServiceAgreed";
  catalogItem?: CatalogItem;
  parameterIsValid?: boolean;
  parameterName?: string;
  parameterValue?: boolean|number|string|undefined;
  termsOfServiceAgreed?: boolean;
}

interface FormStateParameter {
  default?: boolean|number|string|undefined;
  isDisabled?: boolean;
  isHidden?: boolean;
  isRequired?: boolean;
  // isValid is specifically the result of component validation such as min/max on numeric input
  isValid?: boolean;
  name: string;
  spec: CatalogItemSpecParameter;
  // validationMessage and validationResult are set by checking validation condition
  validationMessage?: string|undefined;
  validationResult?: boolean|undefined;
  value?: boolean|number|string|undefined;
}

interface FormStateParameterGroup {
  formGroupLabel: string;
  isRequired?: boolean;
  key: string;
  parameters: FormStateParameter[];
}

function cancelFormStateConditionChecks(state:FormState): void {
  if (state) {
    state.conditionChecks.canceled = true;
  }
}

// Because salesforce checks are asynchronous they need to be resolved before checking the condition logic
async function _checkCondition(condition: string, vars: ConditionValues): Promise<boolean> {
  const checkSalesforceIdRegex = /\bcheck_salesforce_id\(\s*(\w+)\s*\)/g;
  const checkSalesforceIds:string[] = [];
  condition.replace(
    checkSalesforceIdRegex,
    (match, name) => {
      checkSalesforceIds.push(name);
      return match;
    }
  )
  const checkResults:boolean[] = [];
  for (const name of checkSalesforceIds) {
    checkResults.push(await checkSalesforceId(vars[name] as string));
  }
  return checkCondition(
    condition.replace(checkSalesforceIdRegex, () => checkResults.shift() ? "true" : "false"),
    vars,
  )
}

async function checkConditionsInFormState(state:FormState): Promise<void> {
  state.conditionChecks.running = true;

  const conditionValues:ConditionValues = {};
  for (const [name, parameterState] of Object.entries(state.parameters)) {
    conditionValues[name] = parameterState.value;
  }

  for (const [name, parameterState] of Object.entries(state.parameters)) {
    const parameterSpec:CatalogItemSpecParameter = parameterState.spec;

    if (parameterSpec.formDisableCondition) {
      parameterState.isDisabled = await _checkCondition(parameterSpec.formDisableCondition, conditionValues);
      if (state.conditionChecks.canceled) { return }
    } else {
      parameterState.isDisabled = false;
    }

    if (parameterSpec.formHideCondition) {
      parameterState.isHidden = await _checkCondition(parameterSpec.formHideCondition, conditionValues);
      if (state.conditionChecks.canceled) { return }
    } else {
      parameterState.isHidden = false;
    }

    if (parameterSpec.formRequireCondition) {
      parameterState.isRequired = await _checkCondition(parameterSpec.formRequireCondition, conditionValues);
      if (state.conditionChecks.canceled) { return }
    } else {
      parameterState.isRequired = parameterSpec.required;
    }

    if (parameterSpec.validation) {
      if (parameterState.value || parameterSpec.required) {
        try {
          parameterState.validationResult = await _checkCondition(parameterSpec.validation, conditionValues);
          if (state.conditionChecks.canceled) { return }
          parameterState.validationMessage = undefined;
        } catch (error) {
          parameterState.validationResult = false;
          if (error instanceof Error) {
            parameterState.validationMessage = error.message;
          } else {
            parameterState.validationMessage = String(error);
          }
        }
      } else {
        // No value, so skip validation
        parameterState.validationMessage = undefined;
        parameterState.validationResult = undefined;
      }
    }
  }
}

function checkEnableSubmit(state:FormState): boolean {
  if (!state || !state.conditionChecks.complete) {
    return false;
  }
  if (state.termsOfServiceRequired && !state.termsOfServiceAgreed) {
    return false;
  }
  for (const parameter of Object.values(state.parameters)) {
    if (!parameter.isDisabled && !parameter.isHidden) {
      if (parameter.value === undefined) {
        if (parameter.isRequired) {
          return false;
        }
      } else if (
        parameter.isValid === false || parameter.validationResult === false
        && !(parameter.value === '' && !parameter.isRequired)
      ) {
        return false;
      }
    }
  }
  return true;
}

function reduceFormState(state:FormState, action:FormStateAction): FormState {
  switch (action.type) {
    case 'checkConditionsComplete':
      return reduceCheckConditionsComplete(state, action);
    case 'init':
      cancelFormStateConditionChecks(state);
      return reduceFormStateInit(state, action);
    case 'parameterUpdate':
      cancelFormStateConditionChecks(state);
      return reduceFormStateParameterUpdate(state, action);
    case 'termsOfServiceAgreed':
      return reduceFormStateTermsOfServiceAgreed(state, action);
    default:
      throw new Error(`Invalid FormStateAction type: ${action.type}`);
  }
}

function reduceCheckConditionsComplete(state:FormState, action:FormStateAction): FormState {
  return {
    ...state,
    conditionChecks: {
      canceled: false,
      complete: true,
      running: false,
    },
    initComplete: true,
  };
}

function reduceFormStateInit(state:FormState, action:FormStateAction): FormState {
  const catalogItem:CatalogItem = action.catalogItem;
  const formGroups:FormStateParameterGroup[] = [];
  const parameters:{[name: string]: FormStateParameter} = {};

  for (const parameterSpec of catalogItem.spec.parameters || []) {
    const defaultValue:boolean|number|string|undefined = (
      parameterSpec.openAPIV3Schema?.default !== undefined ? parameterSpec.openAPIV3Schema.default : parameterSpec.value
    );
    const parameterState:FormStateParameter = {
      default: defaultValue,
      name: parameterSpec.name,
      spec: parameterSpec,
      value: defaultValue,
    }
    parameters[parameterSpec.name] = parameterState;

    if (parameterSpec.formGroup) {
      const formGroup = formGroups.find(item => item.key === parameterSpec.formGroup);
      if (formGroup) {
        formGroup.parameters.push(parameterState);
      } else {
        formGroups.push({
          formGroupLabel: parameterSpec.formGroup,
          key: parameterSpec.formGroup,
          parameters: [parameterState],
        });
      }
    } else {
      formGroups.push({
        formGroupLabel: parameterSpec.formLabel || parameterSpec.name,
        isRequired: parameterSpec.required,
        key: parameterSpec.name,
        parameters: [parameterState]
      });
    }
  }

  return {
    conditionChecks: {
      canceled: false,
      complete: false,
      running: false,
    },
    formGroups: formGroups,
    initComplete: false,
    parameters: parameters,
    termsOfServiceAgreed: false,
    termsOfServiceRequired: catalogItem.spec.termsOfService ? true : false,
  };
}

function reduceFormStateParameterUpdate(state:FormState, action:FormStateAction): FormState {
  Object.assign(
    state.parameters[action.parameterName],
    {
      value: action.parameterValue,
      isValid: action.parameterIsValid,
    }
  );
  return {
    ...state,
    conditionChecks: {
      canceled: false,
      complete: false,
      running: false,
    },
    initComplete: true,
  }
}

function reduceFormStateTermsOfServiceAgreed(state:FormState, action:FormStateAction): FormState {
  return {
    ...state,
    termsOfServiceAgreed: action.termsOfServiceAgreed,
  }
}

interface CatalogItemRequestFormProps {
  catalogItem: CatalogItem;
  onCancel: () => void;
}

const CatalogItemRequestForm: React.FunctionComponent<CatalogItemRequestFormProps> = ({
  catalogItem,
  onCancel,
}) => {
  const history = useHistory();
  const componentWillUnmount = useRef(false);
  const [formState, dispatchFormState] = useReducer(reduceFormState, undefined);
  const [errorMessage, setErrorMessage] = useState<string|undefined>(undefined);

  const catalogNamespace:CatalogNamespace = useSelector(
    (state) => selectCatalogNamespace(state, catalogItem.metadata.namespace)
  );
  const submitRequestEnabled:boolean = checkEnableSubmit(formState);

  async function submitRequest(): Promise<void> {
    if (!submitRequestEnabled) {
      throw "submitRequest called when submission should be disabled!";
    }
    const parameterValues:CreateServiceRequestParameterValues = {};
    for (const parameterState of Object.values(formState.parameters)) {
      // Add parameters for request that have values and are not disabled or hidden
      if (parameterState.value !== undefined && !parameterState.isDisabled && !parameterState.isHidden && !(parameterState.value === '' && !parameterState.isRequired)) {
        parameterValues[parameterState.name] = parameterState.value;
      }
    }

    const resourceClaim = await createServiceRequest({
      catalogItem: catalogItem,
      catalogNamespace: catalogNamespace,
      parameterValues: parameterValues,
    });

    history.push(`/services/${resourceClaim.metadata.namespace}/${resourceClaim.metadata.name}`);
  }

  async function checkConditions(): Promise<void> {
    try {
      await checkConditionsInFormState(formState);
      dispatchFormState({
        type: "checkConditionsComplete",
      });
    } catch (error) {
      setErrorMessage(`Failed evaluating condition in form ${error}`);
    }
  }

  // First render and detect unmount
  useEffect(() => {
    return () => {
      componentWillUnmount.current = true;
    }
  }, []);

  // Initialize form groups for parameters and default vaules
  React.useEffect(() => {
    setErrorMessage(undefined);
    dispatchFormState({
      type: "init",
      catalogItem: catalogItem,
    });
  }, [catalogItem.metadata.uid]);

  React.useEffect(() => {
    if (formState) {
      if (!formState.conditionChecks.complete) {
        checkConditions();
      }
      return () => {
        if (componentWillUnmount.current) {
          cancelFormStateConditionChecks(formState);
        }
      }
    } else {
      return null;
    }
  }, [formState]);

  if (!formState?.initComplete) {
    return (
      <PageSection>
        <EmptyState variant="full">
          <EmptyStateIcon icon={LoadingIcon} />
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <PageSection variant={PageSectionVariants.light} className="catalog-item-actions">
      <Title headingLevel="h1" size="lg">Request {displayName(catalogItem)}</Title>
      { formState.formGroups.length > 0 ? (
        <p>Request by completing the form. Default values may be provided.</p>
      ) : null }
      { errorMessage ? (
        <p className="error">{ errorMessage }</p>
      ) : null }
      <Form className="catalog-request-form">
        { formState.formGroups.map((formGroup, formGroupIdx) => {
          // do not render form group if all parameters for formGroup are hidden
          if (!formGroup.parameters.find(parameter => !parameter.isHidden)) {
            return null;
          }
          // check if there is an invalid parameter in the form group
          const invalidParameter:FormStateParameter = formGroup.parameters.find(
            parameter => !parameter.isDisabled && (
              parameter.isValid === false || parameter.validationResult === false
           )
          );
          // validated is error if found an invalid parameter
          // validated is success if all form group parameters are validated.
          const validated : 'default' | 'error' | 'success' | 'warning' = (
            invalidParameter ? 'error' : (
              formGroup.parameters.find(
                parameter => parameter.isValid !== true && parameter.validationResult !== true
              ) ? 'default' : 'success'
            )
          );
          return (
            <FormGroup
              key={formGroup.key}
              fieldId={formGroup.parameters.length == 1 ? `${formGroup.key}-${formGroupIdx}` : null}
              isRequired={formGroup.isRequired}
              label={formGroup.formGroupLabel}
              helperTextInvalid={
                <FormHelperText
                  icon={<ExclamationCircleIcon />}
                  isError={validated === 'error'}
                  isHidden={validated !== 'error'}
                >{ invalidParameter ? (
                  invalidParameter.validationMessage || invalidParameter.spec.description
                ) : null }</FormHelperText>
              }
              validated={validated}
            >
              { formGroup.parameters.map(parameterState => {
                const parameterSpec:CatalogItemSpecParameter = parameterState.spec;
                return (
                  <DynamicFormInput
                    key={parameterSpec.name}
                    id={formGroup.parameters.length == 1 ? `${formGroup.key}-${formGroupIdx}` : null}
                    isDisabled={parameterState.isDisabled}
                    parameter={parameterSpec}
                    validationResult={parameterState.validationResult}
                    value={parameterState.value}
                    onChange={(value: boolean|number|string, isValid?:boolean) => {
                      dispatchFormState({
                        type: "parameterUpdate",
                        parameterName: parameterSpec.name,
                        parameterValue: value,
                        parameterIsValid: isValid,
                      });
                    }}
                  />
                );
              } ) }
            </FormGroup>
          )
        } ) }
        { catalogItem.spec.termsOfService ? (
          <TermsOfService
            agreed={formState.termsOfServiceAgreed}
            onChange={(agreed) => {
              dispatchFormState({
                type: 'termsOfServiceAgreed',
                termsOfServiceAgreed: agreed,
              })
            }}
            text={catalogItem.spec.termsOfService}
          />
        ) : null }
        <ActionList>
          <ActionListItem>
            <Button
              isDisabled={!submitRequestEnabled}
              onClick={submitRequest}
            >
              Request
            </Button>
          </ActionListItem>
          <ActionListItem>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </ActionListItem>
        </ActionList>
      </Form>
    </PageSection>
  );
}

export default CatalogItemRequestForm;
