/**
 * just enough protobuf wire format to talk to two spotify endpoints.
 *
 * the alternative is generating code for the extended-metadata schema, which
 * pulls in the whole `spotify.extendedmetadata` tree to read two nested fields.
 * the wire format is simple enough that reading it directly is smaller than the
 * generated types would be, and it does not go stale when spotify adds fields.
 */

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_BYTES = 2;
export const WIRE_FIXED32 = 5;

export interface ProtobufField {
  field: number;
  wire: number;
  /** present for length-delimited fields. */
  bytes?: Buffer;
  /** present for varint and fixed-width fields. */
  value?: number;
}

const encodeVarint = (value: number): number[] => {
  if (value < 0) throw new RangeError('protobuf varint cannot be negative here');

  const out: number[] = [];
  let rest = value;

  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    // `>>>` caps at 32 bits; these values are small, but division keeps it honest
    rest = Math.floor(rest / 128);
  }
  out.push(rest);

  return out;
};

const readVarint = (buffer: Buffer, offset: number): [value: number, next: number] => {
  let result = 0;
  let shift = 1;
  let cursor = offset;

  for (;;) {
    if (cursor >= buffer.length) throw new RangeError('truncated protobuf varint');

    const byte = buffer[cursor++];
    result += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) break;
    shift *= 128;
  }

  return [result, cursor];
};

/** builds a message body; fields must be appended in whatever order the caller wants. */
export class ProtobufWriter {
  private readonly chunks: Buffer[] = [];

  private tag(field: number, wire: number): this {
    this.chunks.push(Buffer.from(encodeVarint((field << 3) | wire)));
    return this;
  }

  varint(field: number, value: number): this {
    return this.tag(field, WIRE_VARINT).push(Buffer.from(encodeVarint(value)));
  }

  bytes(field: number, value: Buffer | Uint8Array): this {
    const buffer = Buffer.from(value);
    return this.tag(field, WIRE_BYTES)
      .push(Buffer.from(encodeVarint(buffer.length)))
      .push(buffer);
  }

  string(field: number, value: string): this {
    return this.bytes(field, Buffer.from(value, 'utf8'));
  }

  /** nest another message under `field`. */
  message(field: number, body: ProtobufWriter | Buffer): this {
    return this.bytes(field, body instanceof ProtobufWriter ? body.finish() : body);
  }

  private push(chunk: Buffer): this {
    this.chunks.push(chunk);
    return this;
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/**
 * split a message into its fields. unknown fields come back too, which is the
 * point: spotify adds them regularly and nothing here should care.
 */
export const readFields = (buffer: Buffer): ProtobufField[] => {
  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const [key, afterKey] = readVarint(buffer, offset);
    const field = key >>> 3;
    const wire = key & 7;

    switch (wire) {
      case WIRE_BYTES: {
        const [length, afterLength] = readVarint(buffer, afterKey);
        const end = afterLength + length;
        if (end > buffer.length) throw new RangeError('truncated protobuf field');

        fields.push({ field, wire, bytes: buffer.subarray(afterLength, end) });
        offset = end;
        break;
      }
      case WIRE_VARINT: {
        const [value, next] = readVarint(buffer, afterKey);
        fields.push({ field, wire, value });
        offset = next;
        break;
      }
      case WIRE_FIXED64:
        fields.push({ field, wire });
        offset = afterKey + 8;
        break;
      case WIRE_FIXED32:
        fields.push({ field, wire });
        offset = afterKey + 4;
        break;
      default:
        throw new RangeError(`unsupported protobuf wire type ${wire}`);
    }
  }

  return fields;
};

export const messagesAt = (fields: ProtobufField[], field: number): Buffer[] =>
  fields.filter((f) => f.field === field && f.bytes).map((f) => f.bytes as Buffer);

export const messageAt = (fields: ProtobufField[], field: number): Buffer | undefined =>
  messagesAt(fields, field)[0];

export const varintAt = (fields: ProtobufField[], field: number): number | undefined =>
  fields.find((f) => f.field === field && f.value !== undefined)?.value;

export const stringAt = (fields: ProtobufField[], field: number): string | undefined =>
  messageAt(fields, field)?.toString('utf8');
