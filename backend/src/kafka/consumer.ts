import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { config } from '../config';
import { logger } from '../utils/logger';

class KafkaConsumer {
  private consumer: Consumer;
  private connected = false;

  constructor() {
    const kafka = new Kafka({
      clientId: `${config.kafka.clientId}-consumer`,
      brokers: config.kafka.brokers,
    });
    this.consumer = kafka.consumer({ groupId: config.kafka.groupId });
  }

  async connect(topics: string[]): Promise<void> {
    try {
      await this.consumer.connect();
      for (const topic of topics) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
      }
      this.connected = true;
      logger.info('Kafka consumer connected', { topics });
    } catch (err) {
      logger.warn('Kafka consumer unavailable', { error: (err as Error).message });
    }
  }

  async run(handler: (payload: EachMessagePayload) => Promise<void>): Promise<void> {
    if (!this.connected) return;
    await this.consumer.run({ eachMessage: handler });
  }
}

export const kafkaConsumer = new KafkaConsumer();
