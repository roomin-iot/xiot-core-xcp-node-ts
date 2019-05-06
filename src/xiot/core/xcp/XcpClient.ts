import {IQQuery} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/iq/IQQuery';
import {IQResult} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/iq/IQResult';

export interface XcpClient {

  connect(host: string, port: number, uri: string): Promise<void>;

  disconnect(): void;

  nextId(): string;

  getSerialNumber(): string;

  getProductId(): number;

  getProductVersion(): number;

  getUdid(): string;

  // sendQuery(query: IQQuery, handler?: (iq: IQ) => void): Promise<IQResult>;

  sendQuery(query: IQQuery): Promise<IQResult>;
}
