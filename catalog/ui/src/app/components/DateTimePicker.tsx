import React, { useEffect, useState } from 'react';
import {
  CalendarMonth,
  InputGroup,
  TextInput,
  Button,
  Popover,
  InputGroupItem,
  DropdownList,
} from '@patternfly/react-core';
import { Dropdown, DropdownItem, MenuToggle, MenuToggleElement } from '@patternfly/react-core';
import OutlinedCalendarAltIcon from '@patternfly/react-icons/dist/js/icons/outlined-calendar-alt-icon';
import OutlinedClockIcon from '@patternfly/react-icons/dist/js/icons/outlined-clock-icon';
import { getLang } from '@app/util';

import './date-time-picker.css';

function getHoursMinutes(timeStr: string): { hours: number; minutes: number } {
  const timeStrArr = timeStr.split(':');
  if (timeStrArr.length !== 2) throw new Error('Invalid time');
  return {
    hours: Number(timeStrArr[0]),
    minutes: Number(timeStrArr[1]),
  };
}
function getDateTime(dateStr: string, timeStr: string): Date {
  const { hours, minutes } = getHoursMinutes(timeStr);
  const valueDateTime = new Date(dateStr);
  valueDateTime.setHours(hours);
  valueDateTime.setMinutes(minutes);
  return valueDateTime;
}
function formatAmPm(timeStr: string): string {
  // eslint-disable-next-line prefer-const
  let { hours, minutes } = getHoursMinutes(timeStr);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours %= 12;
  hours = hours || 12;
  return `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)} ${ampm}`;
}
function formatHHMM(timeStr: string): string {
  let hours = Number(timeStr.match(/^(\d+)/)[1]);
  const minutes = Number(timeStr.match(/:(\d+)/)[1]);
  const AMPM = timeStr.match(/\s(.*)$/)[1];
  if (AMPM === 'PM' && hours < 12) hours = hours + 12;
  if (AMPM === 'AM' && hours === 12) hours = hours - 12;
  return `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;
}
function getDateAndTime(dateTime: Date) {
  return {
    date: dateTime.toISOString(),
    time: `${('00' + dateTime.getHours()).slice(-2)}:${('00' + dateTime.getMinutes()).slice(-2)}`,
  };
}

const DateTimePicker: React.FC<{
  defaultTimestamp: number;
  isDisabled?: boolean;
  onSelect: (date: Date) => void;
  minDate?: number;
  maxDate?: number;
  forceUpdateTimestamp?: number;
}> = ({ defaultTimestamp, isDisabled = false, onSelect, minDate, maxDate, forceUpdateTimestamp }) => {
  const dateFormat = (date: Date, withTime = true) =>
    date.toLocaleDateString([getLang(), 'en-US'], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      timeZoneName: 'short',
    });
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const dateTime = new Date(defaultTimestamp);
  const defaultDateTime = getDateAndTime(dateTime);
  const [valueDate, setValueDate] = useState(defaultDateTime.date);
  const [valueTime, setValueTime] = useState(defaultDateTime.time);
  const hours = Array.from(new Array(24), (_, i) => ('00' + i).slice(-2));
  const minutes = ['00', '15', '30', '45'];

  // sync updated timestamp from parent
  useEffect(() => {
    if (!!forceUpdateTimestamp) {
      const dateTime = new Date(forceUpdateTimestamp);
      const { date, time } = getDateAndTime(dateTime);
      setValueDate(date);
      setValueTime(time);
    }
  }, [forceUpdateTimestamp]);

  const onToggleCalendar = () => {
    setIsCalendarOpen(!isCalendarOpen);
    setIsTimeOpen(false);
  };

  const onToggleTime = () => {
    setIsTimeOpen(!isTimeOpen);
    setIsCalendarOpen(false);
  };

  const _onSelect = (valueDate: string, valueTime: string) => {
    const dateTime = getDateTime(valueDate, valueTime);
    onSelect(dateTime);
  };

  const onSelectCalendar = (newValueDate: Date) => {
    setValueDate(newValueDate.toISOString());
    setIsCalendarOpen(!isCalendarOpen);
    setIsTimeOpen(!isTimeOpen);
    _onSelect(newValueDate.toISOString(), valueTime);
  };

  const onSelectTime = (ev: React.MouseEvent<Element, MouseEvent> | undefined, value: string | number | undefined) => {
    const newValueTime = formatHHMM(String(value));
    setValueTime(newValueTime);
    setIsTimeOpen(!isTimeOpen);
    _onSelect(valueDate, newValueTime);
  };

  const rangeValidatorDate = (date: Date) => {
    if (minDate) {
      const newMinDate = new Date(minDate);
      newMinDate.setDate(newMinDate.getDate() - 1);
      if (date < newMinDate) return false;
    }
    if (maxDate && date > new Date(maxDate)) {
      return false;
    }

    return true;
  };
  const rangeValidatorTime = (date: Date) => {
    if (minDate && date < new Date(minDate)) return false;
    else if (maxDate && date > new Date(maxDate)) return false;

    return true;
  };

  const timeOptions = hours.map((hour) =>
    minutes
      .filter((minute) => rangeValidatorTime(getDateTime(valueDate, `${hour}:${minute}`)))
      .map((minute) => (
        <DropdownItem key={`${hour}-${minute}`} value={formatAmPm(`${hour}:${minute}`)} component="button">
          {formatAmPm(`${hour}:${minute}`)}
        </DropdownItem>
      )),
  );

  const calendar = (
    <CalendarMonth
      date={new Date(valueDate)}
      onChange={(_event, newValueDate: Date) => onSelectCalendar(newValueDate)}
      validators={[rangeValidatorDate]}
    />
  );

  const time = (
    <Dropdown
      isOpen={isTimeOpen}
      onSelect={onSelectTime}
      className="date-time-picker__time-picker"
      onOpenChange={(isOpen: boolean) => setIsTimeOpen(isOpen)}
      isScrollable
      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={toggleRef}
          onClick={onToggleTime}
          isExpanded={isTimeOpen}
          style={{
            padding: '6px 16px',
            ...(isDisabled ? { color: 'var(--pf-v5-global--disabled-color--100)' } : {}),
          }}
          isDisabled={isDisabled}
          className="hide-controls"
        >
          <OutlinedClockIcon />
        </MenuToggle>
      )}
    >
      <DropdownList>{timeOptions.map((item) => item)}</DropdownList>
    </Dropdown>
  );

  const calendarButton = (
    <Button variant="control" aria-label="Toggle the calendar" onClick={onToggleCalendar} isDisabled={isDisabled}>
      <OutlinedCalendarAltIcon />
    </Button>
  );

  return (
    <div style={{ width: '320px' }}>
      <Popover
        position="bottom"
        bodyContent={calendar}
        showClose={false}
        isVisible={isCalendarOpen}
        hasNoPadding
        hasAutoWidth
      >
        <InputGroup>
          <InputGroupItem isFill>
            <TextInput
              type="text"
              id="date-time"
              aria-label="Date and time picker"
              value={dateFormat(getDateTime(valueDate, valueTime), true)}
              className="date-time-picker__text"
              onClick={onToggleCalendar}
              isDisabled={isDisabled}
              readOnlyVariant="default"
            />
          </InputGroupItem>
          {calendarButton}
          {time}
        </InputGroup>
      </Popover>
    </div>
  );
};

export default DateTimePicker;
