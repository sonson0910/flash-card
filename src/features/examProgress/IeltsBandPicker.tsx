import { useId } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { IELTS_TARGET_BANDS, parseIeltsBand } from '../../../functions/src/course-profile-contract';
import './ielts-band-picker.css';

export interface IeltsBandPickerProps {
  /** The stored value. Free text that is not a band selects nothing. */
  readonly value: string | null;
  /** Receives the canonical band ("6.5"). */
  readonly onChange: (band: string) => void;
  /** The visible group label; defaults to "Target band". */
  readonly legend?: string;
  readonly disabled?: boolean;
}

/**
 * IELTS bands 4.0 to 9.0 in half steps as a radio group. Arrow keys move between chips, as in any
 * native radio group, and every chip is a 44px target.
 */
export function IeltsBandPicker({ value, onChange, legend, disabled = false }: IeltsBandPickerProps) {
  const { _ } = useLingui();
  const name = useId();
  const selected = parseIeltsBand(value);
  return (
    <fieldset className="ielts-band-picker" disabled={disabled}>
      <legend className="ielts-band-picker__legend">
        {legend ?? _(msg({ id: 'exam-band-picker.legend', message: 'Target band' }))}
      </legend>
      <div className="ielts-band-picker__chips">
        {IELTS_TARGET_BANDS.map(band => (
          <label key={band} className="ielts-band-picker__chip">
            <input
              type="radio"
              className="ielts-band-picker__input"
              name={name}
              value={band}
              checked={selected === band}
              onChange={() => onChange(band)}
            />
            <span className="ielts-band-picker__value">{band}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
