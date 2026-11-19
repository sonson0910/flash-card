import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatMessage } from './fileCopy';
import { formatBytes, type FileLimits, type FileUsage } from './fileModel';
import './files.css';

export interface StorageUsageMeterProps {
  /** Usage as the service reports it; the meter never estimates bytes on the device. */
  readonly usage: FileUsage;
  readonly limits: FileLimits;
  /** `full` adds used, reserved and limit; `compact` keeps the one caption line. */
  readonly variant?: 'full' | 'compact';
  readonly className?: string;
}

const percentOf = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

/**
 * Storage used by the learner's files against the plan allowance. Mount it wherever usage is
 * shown (the files page aside, the settings section); it needs the `files` catalog loaded.
 */
export function StorageUsageMeter({ usage, limits, variant = 'full', className }: StorageUsageMeterProps) {
  const { _, i18n } = useLingui();
  const used = formatBytes(usage.usedBytes, i18n.locale);
  const reserved = formatBytes(usage.reservedBytes, i18n.locale);
  const limit = formatBytes(limits.limitBytes, i18n.locale);
  const usedPercent = percentOf(usage.usedBytes, limits.limitBytes);
  const reservedPercent = Math.min(100 - usedPercent, percentOf(usage.reservedBytes, limits.limitBytes));
  const label = _(msg({ id: 'files.usage.label', message: 'Storage usage' }));
  const valueText = formatMessage(_, msg({ id: 'files.usage.value', message: '{used} of {limit} used' }), { used, limit });

  return (
    <div className={['sf-files-usage', className].filter(Boolean).join(' ')} data-variant={variant}>
      <div className="sf-files-usage__head">
        <span className="sf-files-usage__label">{label}</span>
        <span className="sf-files-usage__source"><Trans {...msg({ id: 'files.usage.source', message: 'from your account' })} /></span>
      </div>
      <div
        className="sf-files-usage__meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limits.limitBytes}
        aria-valuenow={Math.min(usage.usedBytes, limits.limitBytes)}
        aria-valuetext={valueText}
      >
        <span className="sf-files-usage__used" style={{ width: `${usedPercent}%` }} />
        {reservedPercent > 0 && <span className="sf-files-usage__reserved" style={{ width: `${reservedPercent}%` }} />}
      </div>
      {variant === 'full' && (
        <dl className="sf-files-usage__grid">
          <div>
            <dt><Trans {...msg({ id: 'files.usage.used', message: 'Used' })} /></dt>
            <dd>{used}</dd>
          </div>
          <div>
            <dt><Trans {...msg({ id: 'files.usage.reserved', message: 'Reserved' })} /></dt>
            <dd>{reserved}</dd>
          </div>
          <div>
            <dt><Trans {...msg({ id: 'files.usage.limit', message: 'Limit' })} /></dt>
            <dd>{limit}</dd>
          </div>
        </dl>
      )}
      <p className="sf-files-usage__caption">{valueText}</p>
    </div>
  );
}
