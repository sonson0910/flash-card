import { useId } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatMessage } from './fileCopy';
import { HardDrive } from 'lucide-react';
import { useFileLibrary } from './fileLibrary';
import type { FilePort } from './filePort';
import { formatBytes } from './fileModel';
import { StorageUsageMeter } from './StorageUsageMeter';
import './files.css';

export interface FilesSettingsSectionProps {
  /** The signed-in learner's file service, or null while there is no account to read. */
  readonly port: FilePort | null;
  /** Opens the files page; the settings host owns navigation. */
  readonly onOpenFiles: () => void;
}

/**
 * "Storage and files" block for the settings screen. Mount it inside `.settings-screen` (it uses
 * the screen's `ss-*` row styles) with the `files` catalog loaded. It reads usage and limits from
 * the service and never estimates them; with no port it renders nothing.
 */
export function FilesSettingsSection({ port, onOpenFiles }: FilesSettingsSectionProps) {
  const { _, i18n } = useLingui();
  const library = useFileLibrary(port);
  const headingId = useId();
  if (!port) return null;
  const listing = library.state.listing;

  const summary = library.state.status === 'error' && !listing
    ? _(msg({ id: 'files.settings.error', message: 'Storage usage could not load.' }))
    : listing
      ? formatMessage(_, msg({ id: 'files.settings.summary', message: '{count, plural, one {# file} other {# files}} · {used} of {limit} used' }), {
        count: listing.usage.fileCount,
        used: formatBytes(listing.usage.usedBytes, i18n.locale),
        limit: formatBytes(listing.limits.limitBytes, i18n.locale),
      })
      : _(msg({ id: 'files.settings.loading', message: 'Loading storage usage…' }));

  return (
    <section className="sf-files-settings sf-files-tokens" aria-labelledby={headingId}>
      <h2 id={headingId} className="ss-eyebrow"><Trans {...msg({ id: 'files.settings.title', message: 'Storage and files' })} /></h2>
      <div className="ss-panel ss-panel--rows crystal-chamfer">
        <div className="ss-row">
          <span className="ss-row__icon"><HardDrive size={16} aria-hidden="true" /></span>
          <span className="ss-row__text">
            <span className="ss-row__title"><Trans {...msg({ id: 'files.settings.row', message: 'My files' })} /></span>
            <span className="ss-row__sub" role={library.state.status === 'error' && !listing ? 'alert' : undefined}>{summary}</span>
          </span>
          {library.state.status === 'error' && !listing ? (
            <button type="button" className="ss-secondary fx-press crystal-chamfer-sm" onClick={() => { void library.refresh(); }}>
              <Trans {...msg({ id: 'files.settings.retry', message: 'Retry' })} />
            </button>
          ) : (
            <button type="button" className="ss-secondary fx-press crystal-chamfer-sm" onClick={onOpenFiles}>
              <Trans {...msg({ id: 'files.settings.open', message: 'Open My files' })} />
            </button>
          )}
        </div>
        {listing && (
          <div className="ss-row sf-files-settings__meter">
            <StorageUsageMeter usage={listing.usage} limits={listing.limits} />
          </div>
        )}
      </div>
      <p className="sf-files-settings__note">
        <Trans {...msg({ id: 'files.settings.note', message: 'Files you upload count toward your plan’s storage. Deleting a file frees its space.' })} />
      </p>
    </section>
  );
}
