import { Kafka, Producer, CompressionTypes } from 'kafkajs';
import { config } from '../config';
import { logger } from '../utils/logger';

class KafkaProducer {
  private producer: Producer;
  private connected = false;

  constructor() {
    const kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      retry: { retries: 5 },
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      await this.producer.connect();
      this.connected = true;
      logger.info('Kafka producer connected');
    } catch (err) {
      // Non-fatal — Kafka is for analytics, not the booking critical path
      logger.warn('Kafka unavailable, analytics events will be skipped', { error: (err as Error).message });
    }
  }

  async publish(topic: string, message: Record<string, unknown>): Promise<void> {
    if (!this.connected) return;
    try {
      await this.producer.send({
        topic,
        compression: CompressionTypes.GZIP,
        messages: [{ value: JSON.stringify(message), timestamp: Date.now().toString() }],
      });
    } catch (err) {
      logger.error('Kafka publish failed', { topic, error: (err as Error).message });
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
    }
  }
}

export const kafkaProducer = new KafkaProducer();
