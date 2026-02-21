import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';

export interface CommandPaletteAction {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  open: boolean;
  actions: CommandPaletteAction[];
  onClose: () => void;
}

function toSearchable(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

export function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredActions = useMemo(() => {
    const normalizedQuery = toSearchable(query);
    if (!normalizedQuery) {
      return actions;
    }

    const fuse = new Fuse(actions, {
      threshold: 0.34,
      ignoreLocation: true,
      minMatchCharLength: 2,
      keys: ['title', 'subtitle', 'shortcut', 'keywords'],
    });
    return fuse.search(normalizedQuery).map((result) => result.item);
  }, [actions, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [open]);

  useEffect(() => {
    setActiveIndex((index) => {
      if (filteredActions.length === 0) {
        return 0;
      }
      return Math.min(index, filteredActions.length - 1);
    });
  }, [filteredActions.length]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => {
          if (filteredActions.length === 0) {
            return 0;
          }
          return (index + 1) % filteredActions.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => {
          if (filteredActions.length === 0) {
            return 0;
          }
          return (index - 1 + filteredActions.length) % filteredActions.length;
        });
        return;
      }

      if (event.key === 'Enter') {
        const action = filteredActions[activeIndex];
        if (!action || action.disabled) {
          return;
        }
        event.preventDefault();
        onClose();
        void Promise.resolve(action.run());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeIndex, filteredActions, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-label="Command Palette"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="command-palette-head">
          <h3>Команды</h3>
          <button type="button" className="btn ghost" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <label className="command-palette-search">
          Поиск команды
          <input
            ref={inputRef}
            type="text"
            placeholder="Например: импорт, читалка, плотность"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="command-palette-list">
          {filteredActions.length === 0 ? (
            <p className="muted">Команды не найдены.</p>
          ) : (
            filteredActions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={`command-item ${index === activeIndex ? 'active' : ''}`}
                disabled={action.disabled}
                onClick={() => {
                  if (action.disabled) {
                    return;
                  }
                  onClose();
                  void Promise.resolve(action.run());
                }}
              >
                <span className="command-item-main">
                  <strong>{action.title}</strong>
                  {action.subtitle ? <small className="muted">{action.subtitle}</small> : null}
                </span>
                {action.shortcut ? <code>{action.shortcut}</code> : null}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
