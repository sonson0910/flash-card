import { msg } from '@lingui/core/macro';
import type { ReactNode } from 'react';
import { Trans } from '@lingui/react';
import lumiThinking from '../assets/lumi/lumi-thinking.webp';
import './system-feedback.css';

export function WorkspaceLoadingPanel({ children }: { children?: ReactNode }) {
  return (
    <section className="workspace-loading-panel crystal-chamfer" role="status" aria-busy="true">
      <div className="workspace-loading-panel-inner">
        <span className="workspace-loading-bar workspace-loading-bar-title skeleton-sheen" aria-hidden="true" />
        <span className="workspace-loading-bar workspace-loading-bar-subtitle skeleton-sheen" aria-hidden="true" />
        <div className="workspace-loading-cards" aria-hidden="true">
          {[0, 1, 2].map(index => (
            <span className="workspace-loading-card skeleton-sheen" key={index} />
          ))}
        </div>
        <span className="workspace-loading-bar workspace-loading-bar-footer skeleton-sheen" aria-hidden="true" />
        <span className="workspace-loading-label">
          <span className="workspace-loading-spinner" />
          <span>{children ?? <Trans {...msg({ context: 'shell.loading.workspace', message: 'Loading workspace…' })} />}</span>
        </span>
        <img
          src={lumiThinking}
          alt=""
          aria-hidden="true"
          width={110}
          height={110}
          loading="lazy"
          data-lumi-pose="thinking"
          className="workspace-loading-lumi"
        />
      </div>
    </section>
  );
}
