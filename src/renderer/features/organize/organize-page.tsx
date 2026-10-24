import { useState } from 'react';
import { Link } from 'react-router';
import { Check, CircleAlert, Pencil, Play, X } from 'lucide-react';
import { CATEGORIES, type Category } from '@shared/constants';
import type { ExecutionResult, PlanOperationView } from '@shared/types/domain';
import { Badge, Button, Card, ConfidenceIndicator, ConfirmationDialog, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Select, StatusIndicator, Table, Td, Th } from '../../components/ui';
import { useApiMutation, useJobs, usePlan, useSettings } from '../../hooks/use-api';
import { JobProgressCard } from '../folders/job-progress';
import { api } from '../../lib/api';
import { useUi } from '../../stores/ui-store';

function EditDialog({ op, onClose }: { op: PlanOperationView | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('other');
  const [seed, setSeed] = useState<string | null>(null);
  if (op && seed !== op.id) { setSeed(op.id); setName(op.destFileName); setCategory(op.category); }
  const edit = useApiMutation((i: { operationId: string; category: Category; fileName: string }) => api()['plans.edit'](i), { success: 'Updated. Re-approve to include it.', onSuccess: onClose });
  return (
    <Dialog open={!!op} onClose={onClose} title="Edit proposal" description="The destination folder is derived from the category; you only choose a category and a file name."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={edit.isPending} onClick={() => op && edit.mutate({ operationId: op.id, category, fileName: name })}>Save</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (op) edit.mutate({ operationId: op.id, category, fileName: name }); }}>
        <Field label="New file name" hint="Include the extension. Slashes and special characters are not allowed.">{(p) => <Input data-autofocus id={p.id} aria-describedby={p.describedBy} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Category">{(p) => <Select id={p.id} value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c[0]?.toUpperCase()}{c.slice(1)}</option>)}</Select>}</Field>
      </form>
    </Dialog>
  );
}

function ResultDialog({ result, onClose }: { result: ExecutionResult | null; onClose: () => void }) {
  return (
    <Dialog open={!!result} onClose={onClose} title="Execution finished" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {result && (
        <div className="space-y-3 text-[13px]">
          <p><strong>{result.completed}</strong> moved · <strong>{result.failed}</strong> failed · <strong>{result.skipped}</strong> skipped{result.cancelled && ' · cancelled'}</p>
          {result.outcomes.filter((o) => o.status !== 'completed').map((o) => <p key={o.operationId} className="rounded-md bg-warn-soft p-2 text-warn">{o.message ?? o.status}</p>)}
          {result.failed === 0 && result.completed > 0 && <p className="text-muted">Every move is recorded in History, where it can be undone while it is still safe to do so.</p>}
        </div>
      )}
    </Dialog>
  );
}

export function OrganizePage() {
  const { activePlanId } = useUi();
  const plan = usePlan(activePlanId);
  const settings = useSettings();
  const jobs = useJobs();
  const [editing, setEditing] = useState<PlanOperationView | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const approve = useApiMutation((i: { operationIds: string[]; approved: boolean }) => api()['plans.approve'](i));
  const execute = useApiMutation((i: { planId: string; confirmedOperationIds: string[] }) => api()['plans.execute'](i), { onSuccess: (r) => { setConfirm(false); setResult(r); } });

  if (!activePlanId) return (<><PageHeader title="Organize" /><Card><EmptyState title="No plan yet" description="Select files on the Files page and choose “Build plan”. You can review, edit and approve every move before anything happens." action={<Link className="text-accent underline" to="/files">Go to Files</Link>} /></Card></>);
  if (plan.isLoading) return <LoadingState label="Loading plan" />;
  if (plan.error || !plan.data) return <ErrorState message={plan.error?.message ?? 'Plan not found'} onRetry={() => void plan.refetch()} />;

  const ops = plan.data.operations;
  const pending = ops.filter((o) => !['completed', 'executing'].includes(o.status));
  const approved = ops.filter((o) => o.status === 'approved');
  const approvable = pending.filter((o) => o.validationErrors.length === 0 && o.status !== 'approved' && o.status !== 'rejected');
  const threshold = settings.data?.confidenceThreshold ?? 0.6;
  const runningJob = (jobs.data ?? []).find((j) => j.type === 'execute' && (j.status === 'running' || j.status === 'queued'));

  return (
    <>
      <PageHeader title="Review your plan" description="These are suggestions, not facts. Approve the moves you want; nothing happens to your files until you confirm at the end."
        actions={<>
          <Button disabled={!approvable.length} onClick={() => approve.mutate({ operationIds: approvable.filter((o) => !o.lowConfidence).map((o) => o.id), approved: true })}>Approve all safe ({approvable.filter((o) => !o.lowConfidence).length})</Button>
          <Button variant="primary" icon={<Play className="size-4" />} disabled={!approved.length} onClick={() => setConfirm(true)}>Review & run ({approved.length})</Button>
        </>} />
      <p className="mb-3 text-xs text-muted">“Approve all safe” skips anything with warnings or confidence below {Math.round(threshold * 100)}%. Review those individually.</p>
      {ops.length === 0 ? <Card><EmptyState title="This plan is empty" description="None of the selected files could be planned (they may have moved or changed)." /></Card> : (
        <Card>
          <Table aria-label="Planned operations">
            <thead><tr><Th>File</Th><Th>Destination</Th><Th>Confidence</Th><Th>Checks</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {ops.map((o) => {
                const locked = ['completed', 'executing'].includes(o.status);
                return (
                  <tr key={o.id} className={o.status === 'rejected' ? 'opacity-55' : undefined}>
                    <Td><p className="break-all font-medium">{o.originalName}</p><p className="break-all font-mono text-[11px] text-muted">{o.relativeSource}</p></Td>
                    <Td><p className="break-all">{o.destFileName}</p><p className="break-all font-mono text-[11px] text-muted">→ {o.relativeDestination}</p>{o.reason && <p className="mt-1 text-xs text-muted">“{o.reason}”</p>}</Td>
                    <Td><ConfidenceIndicator value={o.confidence} threshold={threshold} /></Td>
                    <Td>{o.validationErrors.length === 0 ? <Badge tone="accent"><Check className="size-3" />Ready</Badge> : <ul className="space-y-1">{o.validationErrors.map((m) => <li key={m} className="flex gap-1 text-xs text-danger"><CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />{m}</li>)}</ul>}</Td>
                    <Td><StatusIndicator status={o.status} /></Td>
                    <Td>
                      <span className="flex gap-1">
                        <Button size="sm" variant={o.status === 'approved' ? 'primary' : 'secondary'} disabled={locked || (o.status !== 'approved' && o.validationErrors.length > 0)} icon={<Check className="size-3.5" />}
                          aria-label={`${o.status === 'approved' ? 'Unapprove' : 'Approve'} ${o.originalName}`} onClick={() => approve.mutate({ operationIds: [o.id], approved: o.status !== 'approved' })}>{o.status === 'approved' ? 'Approved' : 'Approve'}</Button>
                        <Button size="sm" variant="ghost" disabled={locked} icon={<Pencil className="size-3.5" />} aria-label={`Edit ${o.originalName}`} onClick={() => setEditing(o)}>Edit</Button>
                        <Button size="sm" variant="ghost" disabled={locked || o.status === 'rejected'} icon={<X className="size-3.5" />} aria-label={`Reject ${o.originalName}`} onClick={() => approve.mutate({ operationIds: [o.id], approved: false })}>Reject</Button>
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
      <EditDialog op={editing} onClose={() => setEditing(null)} />
      <ResultDialog result={result} onClose={() => setResult(null)} />
      <ConfirmationDialog open={confirm} onCancel={() => setConfirm(false)} loading={execute.isPending} confirmLabel={`Move ${approved.length} file${approved.length === 1 ? '' : 's'}`}
        onConfirm={() => execute.mutate({ planId: plan.data.planId, confirmedOperationIds: approved.map((o) => o.id) })}
        title="Move these files?" description="Each file is checked again right before it moves. Nothing is overwritten and nothing is deleted.">
        <ul className="sf-scroll max-h-64 space-y-1 overflow-auto text-[13px]">
          {approved.map((o) => <li key={o.id} className="break-all"><span className="text-muted">{o.relativeSource}</span> → <strong>{o.relativeDestination}</strong></li>)}
        </ul>
        <p className="mt-3 text-xs text-muted">You can reverse eligible moves later from History.</p>
        {runningJob && <div className="mt-3"><JobProgressCard job={runningJob} /><p className="mt-1 text-xs text-muted">Cancelling stops before the next file; a file that is mid-move always finishes safely.</p></div>}
      </ConfirmationDialog>
    </>
  );
}
