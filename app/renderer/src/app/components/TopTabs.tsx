import type { AppView } from '../types';
import { LiquidSurface } from './LiquidSurface';

interface TopTabsProps {
  activeView: AppView;
  onChange: (view: AppView) => void;
  canOpenReader: boolean;
  canOpenHighlights: boolean;
  canOpenInsights: boolean;
  libraryCount?: number;
  highlightsCount?: number;
}

const tabs: Array<{ id: AppView; label: string }> = [
  { id: 'library', label: 'Библиотека' },
  { id: 'reader', label: 'Читалка' },
  { id: 'highlights', label: 'Хайлайты' },
  { id: 'insights', label: 'Insights' },
];

export function TopTabs({
  activeView,
  onChange,
  canOpenReader,
  canOpenHighlights,
  canOpenInsights,
  libraryCount = 0,
  highlightsCount = 0,
}: TopTabsProps) {
  return (
    <LiquidSurface className="tabs-shell" tone="pill" padding="4px" radius={999}>
      <div className="glass-tabs" role="tablist" aria-label="Навигация по приложению">
        {tabs.map((tab) => {
          const disabled =
            (tab.id === 'reader' && !canOpenReader) ||
            (tab.id === 'highlights' && !canOpenHighlights) ||
            (tab.id === 'insights' && !canOpenInsights);

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-selected={activeView === tab.id}
              data-active={activeView === tab.id ? 'true' : 'false'}
              className={`glass-tab ${activeView === tab.id ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => onChange(tab.id)}
            >
              <span className="tab-label">{tab.label}</span>
              {tab.id === 'library' ? (
                <>
                  {' '}
                  <span className="tab-badge" aria-hidden="true">
                    {libraryCount}
                  </span>
                </>
              ) : null}
              {tab.id === 'highlights' ? (
                <>
                  {' '}
                  <span className="tab-badge" aria-hidden="true">
                    {highlightsCount}
                  </span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </LiquidSurface>
  );
}
