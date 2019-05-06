import {XcpClient} from '../XcpClient';
import {XcpClientVerifier} from '../XcpClientVerifier';
import {XcpClientVerifierImpl} from './XcpClientVerifierImpl';
import {XcpFrameCodecType} from '../common/XcpFrameCodecType';
import {XcpClientCipher} from '../XcpClientCipher';
import {XcpMessageCodec} from 'xiot-core-message-ts/dist/xiot/core/message/codec/XcpMessageCodec';
import {XcpMessage} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/XcpMessage';
import {IQ} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/iq/IQ';
import {IQType} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/iq/IQType';
import {IQQuery} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/iq/IQQuery';
import {IQResult} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/iq/IQResult';
import {IQError} from 'xiot-core-message-ts/dist/xiot/core/message/typedef/iq/IQError';
import {XcpSessionKey} from '../common/XcpSessionKey';
import {WebSocketBinaryFrameCodecImpl} from '../codec/WebSocketBinaryFrameCodecImpl';
import {BinaryFrameCodec} from '../BinaryFrameCodec';
import {Utf8ArrayToStr} from '../utils/Uint8ArrayUtils';

export class XcpClientImpl implements XcpClient {

  private ws: WebSocket | null = null;
  private verifier: XcpClientVerifier | null = null;
  private verified = false;
  private msgIndex = 0;
  private frameCodec: BinaryFrameCodec | null = null;
  private messageCodec: XcpMessageCodec;
  private resultHandlers: Map<string, (result: IQResult | null, error: IQError | null) => void>;
  private verifyHandler: (result: boolean) => void = () => {};

  constructor(private deviceId: string,
              private productId: number,
              private productVersion: number,
              private cipher: XcpClientCipher,
              private codec: XcpFrameCodecType) {
    this.messageCodec = new XcpMessageCodec();
    this.resultHandlers = new Map<string, (result: IQResult | null, error: IQError | null) => void>();
  }

  connect(host: string, port: number, uri: string): Promise<void> {
    const url = 'ws://' + host + ':' + port + uri;
    console.log('connect: ' + url);
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => this.onConnected());
    this.ws.addEventListener('close', () => this.onDisconnect());
    this.ws.addEventListener('error', () => this.onError());
    this.ws.addEventListener('message', event => this.onMessage(event));

    return new Promise<void>((resolve, reject) => {
      this.verifyHandler = (result) => {
        if (result) {
          resolve();
          return;
        }

        reject();
      };
    });
  }

  disconnect(): void {
    if (this.ws != null) {
      this.ws.close();
    }
  }

  private onConnected(): void {
    console.log('onConnected');
    this.startVerify('1.0')
      .then(() => this.verifyHandler(true))
      .catch(e => this.verifyHandler(false));
  }

  private onDisconnect(): void {
    console.log('onDisconnect');
    this.ws = null;
  }

  private onError(): void {
    console.log('onError');
    this.ws = null;
  }

  private onMessage(event: MessageEvent): void {
    console.log('onMessage: ', event.data);

    let msg: XcpMessage | null = null;

    if (this.frameCodec == null) {
      msg = this.messageCodec.decode(event.data);
    } else {
      const data = this.frameCodec.decrypt(event.data);
      if (data != null) {
        const s = Utf8ArrayToStr(data);
        msg = this.messageCodec.decode(s);
      }
    }

    if (msg == null) {
      return;
    }

    this.handleMessage(msg);

    // this.handler.message = event.data;
    // console.log('handle.message: ', this.handler.message);
  }

  private handleMessage(message: XcpMessage) {
    if (message instanceof IQ) {
      switch (message.type) {
        case IQType.QUERY:
          this.handleQuery(message);
          break;

        case IQType.RESULT:
          this.handleResult(message);
          break;

        case IQType.ERROR:
          this.handleError(message);
          break;

        default:
          console.log('invalid message: ', message);
          break;
      }
    } else {
      console.log('message not IQ: ', message);
    }
  }

  private handleQuery(query: IQ) {
    if (! (query instanceof IQQuery)) {
      return;
    }

    console.log('handleQuery: ', query.method);
  }

  private handleResult(result: IQ) {
    if (! (result instanceof IQResult)) {
      return;
    }

    console.log('handleResult: ', result.method);

    const handler = this.resultHandlers.get(result.id);
    if (handler != null) {
      handler(result, null);
      this.resultHandlers.delete(result.id);
    } else {
      console.log('handle for result not found: ', result.id);
    }
  }

  private handleError(error: IQ) {
    if (! (error instanceof IQError)) {
      return;
    }

    const handler = this.resultHandlers.get(error.id);
    if (handler != null) {
      handler(null, error);
      this.resultHandlers.delete(error.id);
    } else {
      console.log('handle for error not found: ', error.id);
    }
  }

  private startVerify(version: string): Promise<void> {
    this.verifier = new XcpClientVerifierImpl(this, version, this.cipher, this.codec);
    return this.verifier.start().then(x => this.setXcpSessionKey(x));
  }

  private setXcpSessionKey(key: XcpSessionKey): void {
    if (key.codec !== XcpFrameCodecType.NOT_CRYPT) {
      this.frameCodec = new WebSocketBinaryFrameCodecImpl(key.deviceToServer, key.serverToDevice);
    }

    console.log('verify succeed!');
    this.verified = true;
  }

  private parseError(error: any) {
    console.error('An error occurred', error);
  }

  nextId(): string {
    return'msg#' + this.msgIndex++;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getProductId(): number {
    return this.productId;
  }

  getProductVersion(): number {
    return this.productVersion;
  }

  private write(o: Object) {
    const s = JSON.stringify(o);
    console.log('write: ', s);

    if (this.ws != null) {
      this.ws.send(s);
    }
  }

  sendQuery(query: IQQuery): Promise<IQResult> {
    this.write(this.messageCodec.encode(query));
    return new Promise<IQResult>((resolve, reject) => {
      this.resultHandlers.set(query.id, (result, error) => {
        if (error != null) {
          reject(error);
          return;
        }

        if (result == null) {
          return;
        }

        resolve(result);
      });
    });
  }
}
