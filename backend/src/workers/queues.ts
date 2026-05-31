import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { notificationService } from '../services/notification/notificationService';
import { workerLogger } from '../utils/logger';
import { createRetryableQueue, handleDeadLetter, backoffMs } from './dlq/deadLetterQueue';

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

export const notificationQueue = createRetryableQueue('notifications');

export function startNotificationWorker(): Worker {
  const worker = new Worker(
    'notifications',
    async (job: Job) => {
      workerLogger.info('Processing notification', { type: job.data.type, id: job.id });
      await notificationService.send(job.data);
    },
    {
      connection,
      concurrency: 10,
      limiter: { max: 100, duration: 1000 },
      settings: {
        backoffStrategy: (attemptsMade: number) => backoffMs(attemptsMade),
      },
    }
  );

  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 5)) {
      await handleDeadLetter(job, err, 'notifications');
    }
    workerLogger.error('Notification job failed', {
      job_id: job?.id,
      attempts: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    workerLogger.error('Notification worker error', { error: err.message });
  });

  return worker;
}
