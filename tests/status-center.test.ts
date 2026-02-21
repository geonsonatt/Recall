import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStatusCenter,
  completeStatusOperationError,
  completeStatusOperationSuccess,
  createStatusOperation,
  getStatusSnapshot,
  retryStatusOperation,
  setStatusOperationRetry,
} from '../app/renderer/src/app/lib/statusCenter';

describe('status center', () => {
  beforeEach(() => {
    clearStatusCenter('all');
  });

  it('tracks pending/success/error operations with counters', () => {
    const pendingId = createStatusOperation({ name: 'pending-op' });
    const successId = createStatusOperation({ name: 'success-op' });
    const errorId = createStatusOperation({ name: 'error-op' });

    completeStatusOperationSuccess(successId, { durationMs: 32 });
    completeStatusOperationError(errorId, {
      durationMs: 91,
      errorCode: 'E_TEST',
      errorMessage: 'ошибка',
    });

    const snapshot = getStatusSnapshot();
    expect(snapshot.total).toBe(3);
    expect(snapshot.pending).toBe(1);
    expect(snapshot.errors).toBe(1);

    const pending = snapshot.operations.find((item) => item.id === pendingId);
    const success = snapshot.operations.find((item) => item.id === successId);
    const failed = snapshot.operations.find((item) => item.id === errorId);

    expect(pending?.state).toBe('pending');
    expect(success?.state).toBe('success');
    expect(failed?.state).toBe('error');
  });

  it('retries errored operations through retry queue callback', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const opId = createStatusOperation({
      name: 'retry-op',
      retry,
    });

    completeStatusOperationError(opId, {
      errorCode: 'E_FAIL',
      errorMessage: 'boom',
    });

    const before = getStatusSnapshot();
    expect(before.retryQueue).toBe(1);

    const retried = await retryStatusOperation(opId);
    expect(retried).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);

    completeStatusOperationSuccess(opId, { durationMs: 15 });

    const after = getStatusSnapshot();
    const operation = after.operations.find((item) => item.id === opId);
    expect(operation?.attempts).toBeGreaterThanOrEqual(2);
    expect(operation?.state).toBe('success');
  });

  it('can attach retry callback after operation creation', async () => {
    const opId = createStatusOperation({ name: 'late-retry' });
    completeStatusOperationError(opId, { errorCode: 'E_LATE' });

    const retry = vi.fn().mockResolvedValue(undefined);
    setStatusOperationRetry(opId, retry);

    const retried = await retryStatusOperation(opId);
    expect(retried).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
