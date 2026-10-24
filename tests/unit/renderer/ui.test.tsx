// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfidenceIndicator, ConfirmationDialog, Dialog, DropdownMenu, EmptyState, ErrorState, Pagination, StatusIndicator, Switch, ToastProvider, useToast, Button } from '../../../src/renderer/components/ui';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (<><div id="root"><button onClick={() => setOpen(true)}>Open</button></div><Dialog open={open} onClose={() => setOpen(false)} title="Hello"><button>First</button><button>Last</button></Dialog></>);
}

describe('Dialog accessibility', () => {
  it('moves focus in, traps Tab, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Hello' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab(); await user.tab(); await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true); // Tab wraps inside the dialog
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('ConfirmationDialog', () => {
  it('calls confirm only when confirmed and cancels with Escape', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<ConfirmationDialog open onConfirm={onConfirm} onCancel={onCancel} title="Move?" confirmLabel="Move 2 files" />);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Move 2 files' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('DropdownMenu keyboard', () => {
  it('opens with ArrowDown, navigates, selects with Enter, Escape restores focus', async () => {
    const user = userEvent.setup();
    const a = vi.fn(); const b = vi.fn();
    render(<DropdownMenu label="Actions" trigger={<span>⋯</span>} items={[{ label: 'One', onSelect: a }, { label: 'Two', onSelect: b }]} />);
    const btn = screen.getByRole('button', { name: 'Actions' });
    btn.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(b).toHaveBeenCalled(); expect(a).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(btn).toHaveFocus();
  });
});

describe('small components', () => {
  it('Switch exposes role and state', async () => {
    const user = userEvent.setup(); const fn = vi.fn();
    render(<Switch label="Use AI" checked={false} onChange={fn} />);
    const s = screen.getByRole('switch', { name: 'Use AI' });
    expect(s).toHaveAttribute('aria-checked', 'false');
    await user.click(s);
    expect(fn).toHaveBeenCalledWith(true);
  });
  it('ConfidenceIndicator labels low confidence in words, not only colour', () => {
    render(<><ConfidenceIndicator value={0.4} threshold={0.6} /><ConfidenceIndicator value={null} /></>);
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('No AI suggestion')).toBeInTheDocument();
  });
  it('EmptyState and ErrorState render useful text; ErrorState announces and retries', async () => {
    const user = userEvent.setup(); const retry = vi.fn();
    render(<><EmptyState title="No files yet" description="Scan first." /><ErrorState message="Boom" onRetry={retry} /></>);
    expect(screen.getByText('No files yet')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });
  it('Pagination disables boundaries and reports range', async () => {
    const user = userEvent.setup(); const change = vi.fn();
    render(<Pagination offset={0} limit={50} total={120} onChange={change} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByText(/1–50 of 120/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(change).toHaveBeenCalledWith(50);
  });
  it('StatusIndicator maps statuses to readable words', () => {
    render(<><StatusIndicator status="interrupted" /><StatusIndicator status="undone" /></>);
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(screen.getByText('Reversed')).toBeInTheDocument();
  });
  it('Button in loading state is disabled and busy', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');
  });
});

function ToastHarness() { const t = useToast(); return <button onClick={() => t.show('error', 'It failed')}>go</button>; }
describe('Toast', () => {
  it('shows errors as alerts that persist until dismissed', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><ToastHarness /></ToastProvider>);
    await user.click(screen.getByText('go'));
    expect(screen.getByRole('alert')).toHaveTextContent('It failed');
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
