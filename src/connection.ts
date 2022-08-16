import { connect, Socket } from 'node:net';

type TcpConnectionProps = {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
};

export class MysqlConnection {
  socket: Socket;

  sequenceId = 0;
  compressedSequenceId = 0;

  constructor(private readonly props: TcpConnectionProps) {
    this.socket = connect(props.port, props.host);
    this.socket.on('connect', this.onSocketConnected);
    this.socket.on('error', this.onSocketError);
    this.socket.on('data', this.onSocketData);
    this.socket.on('close', this.onSocketClosed);
  }

  private onSocketConnected = () => {
    console.log('Connected...');
  };

  private onSocketError = (err: Error) => {
    console.error(err);
  };

  private onSocketData = (data: Buffer) => {
    console.log(data);
  };

  private onSocketClosed = () => {
    console.log('Closed');
  };
}
