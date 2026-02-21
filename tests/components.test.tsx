// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiquidSurface } from '../app/renderer/src/app/components/LiquidSurface';
import { Toast } from '../app/renderer/src/app/components/Toast';
import { TopTabs } from '../app/renderer/src/app/components/TopTabs';

describe('shared components', () => {
  it('renders LiquidSurface with tone defaults and custom radius', () => {
    const { container } = render(
      <LiquidSurface tone="pill" radius={16}>
        <span>Контент</span>
      </LiquidSurface>,
    );

    expect(screen.getByText('Контент')).toBeInTheDocument();
    expect(container.querySelector('.liquid-surface-pill')).toBeInTheDocument();
    expect(container.querySelector('.liquid-surface')).toHaveStyle({ borderRadius: '16px' });
  });

  it('renders Toast only when message is not empty', () => {
    const { rerender } = render(<Toast message="" />);
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<Toast message="Готово" type="success" />);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Готово');
    expect(toast).toHaveClass('toast-success');
  });

  it('disables unavailable tabs and emits change for active options', () => {
    const onChange = vi.fn();
    render(
      <TopTabs
        activeView="library"
        onChange={onChange}
        canOpenReader={false}
        canOpenHighlights={true}
        canOpenInsights={false}
      />,
    );

    const libraryTab = screen.getByRole('tab', { name: 'Библиотека' });
    const readerTab = screen.getByRole('tab', { name: 'Читалка' });
    const highlightsTab = screen.getByRole('tab', { name: 'Хайлайты' });
    const insightsTab = screen.getByRole('tab', { name: 'Insights' });

    expect(libraryTab).toHaveAttribute('aria-selected', 'true');
    expect(readerTab).toBeDisabled();
    expect(highlightsTab).not.toBeDisabled();
    expect(insightsTab).toBeDisabled();

    fireEvent.click(highlightsTab);
    expect(onChange).toHaveBeenCalledWith('highlights');
  });
});
