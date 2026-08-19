import Long from 'long';
import _m0 from 'protobufjs/minimal.js';
import { Message } from '@bufbuild/protobuf';
import { Duration } from '@bufbuild/protobuf/wkt';

declare class AES_CMAC {
    private readonly BLOCK_SIZE;
    private readonly XOR_RIGHT;
    private readonly EMPTY_BLOCK_SIZE_BUFFER;
    private _key;
    private _subkeys;
    constructor(key: Buffer);
    calculate(message: Buffer): Buffer;
    private _generateSubkeys;
    private _getBlockCount;
    private _aes;
    private _getLastBlock;
    private _padding;
    private _bitShiftLeft;
    private _xor;
}

/**
 * base62 codec over bigint-sized values. spotify ids are 22-char base62, which is
 * well past `Number.MAX_SAFE_INTEGER`, so both directions work in bigint and
 * exchange decimal strings with the caller.
 */
declare class Base62 {
    private readonly base;
    private readonly charset;
    /** char -> value, so decode does not pay a linear scan per character. */
    private readonly values;
    constructor(customCharset?: string | string[]);
    /** encode a decimal string (or bigint) into base62. */
    encode(integer: string | bigint): string;
    /** decode base62 into a decimal string. */
    decode(str: string): string;
}

/**
 * every error thrown by respotify derives from {@link RespotifyError}, so callers
 * can tell "the library failed" apart from "something else in the process failed"
 * with a single `instanceof` check.
 */
declare class RespotifyError extends Error {
    readonly cause?: unknown;
    constructor(message: string, cause?: unknown);
}
/** a request exhausted its retry budget, or failed in a way retrying cannot fix. */
declare class HttpError extends RespotifyError {
    readonly status: number;
    readonly url: string;
    readonly body?: string | undefined;
    constructor(message: string, status: number, url: string, body?: string | undefined);
    /** 408/429/5xx are worth another attempt; everything else is terminal. */
    get retryable(): boolean;
}
/** the request did not complete within its deadline. */
declare class TimeoutError extends RespotifyError {
    readonly url: string;
    readonly timeoutMs: number;
    constructor(url: string, timeoutMs: number);
}
/** login5 rejected the credentials, or the session could not be renewed. */
declare class AuthError extends RespotifyError {
    readonly reason?: string | undefined;
    constructor(message: string, reason?: string | undefined);
}
/** the access token is gone or expired and no credential is available to renew it. */
declare class TokenExpiredError extends AuthError {
    constructor();
}
/** the requested track/episode could not be resolved, or has no downloadable file. */
declare class DownloadError extends RespotifyError {
}
/** ffmpeg (or another decryptor backend) failed to produce plaintext audio. */
declare class DecryptError extends RespotifyError {
}
/**
 * the file was located, but decrypting it needs an audio key.
 *
 * spotify moved off widevine-protected mp4 for these formats: the audio is now
 * ogg/aac/flac encrypted with aes-128-ctr under a per-file key, and that key is
 * only served over the access-point protocol. distinct from
 * {@link DownloadError} so callers can tell "this track does not exist" from
 * "this build cannot decrypt it yet".
 */
declare class AudioKeyRequiredError extends RespotifyError {
    readonly fileId: string;
    readonly format: string;
    constructor(fileId: string, format: string);
}

interface HttpClientOptions {
    /** proxy url (`http://`, `https://`, or `socks5://` if the runtime supports it). */
    proxy?: string;
    /** per-attempt deadline. defaults to 30s. */
    timeoutMs?: number;
    /** extra attempts after the first one. defaults to 3. */
    retries?: number;
    /** base delay for exponential backoff. defaults to 500ms. */
    retryDelayMs?: number;
    /** headers merged into every request. */
    headers?: Record<string, string>;
    /** swap in a custom fetch (tests, instrumentation). defaults to global fetch. */
    fetch?: typeof globalThis.fetch;
}
interface HttpRequestOptions extends Omit<RequestInit, 'signal'> {
    timeoutMs?: number;
    retries?: number;
    /** treat these statuses as success instead of throwing (e.g. `[404]`). */
    allowStatus?: number[];
}
/**
 * a small fetch wrapper that every spotify call goes through: per-attempt timeouts,
 * exponential backoff with retry-after support, and optional per-instance proxying.
 *
 * proxy agents are cached per url so a long-lived downloader reuses connections
 * instead of opening a fresh pool on every request.
 */
declare class HttpClient {
    private readonly options;
    private static proxyAgents;
    private readonly fetchImpl;
    private readonly dispatcher?;
    readonly timeoutMs: number;
    readonly retries: number;
    readonly retryDelayMs: number;
    readonly headers: Record<string, string>;
    constructor(options?: HttpClientOptions);
    private static agentFor;
    /** derive a client that shares this one's settings, overriding some of them. */
    extend(options: HttpClientOptions): HttpClient;
    request(url: string, init?: HttpRequestOptions): Promise<Response>;
    private attempt;
    /** exponential backoff with jitter, so retries from parallel callers spread out. */
    private backoff;
    json<T>(url: string, init?: HttpRequestOptions): Promise<T>;
    buffer(url: string, init?: HttpRequestOptions): Promise<Buffer>;
    bytes(url: string, init?: HttpRequestOptions): Promise<Uint8Array>;
}
/** shared client for callers that do not need proxying or custom tuning. */
declare const defaultHttpClient: HttpClient;

/**
 * just enough protobuf wire format to talk to two spotify endpoints.
 *
 * the alternative is generating code for the extended-metadata schema, which
 * pulls in the whole `spotify.extendedmetadata` tree to read two nested fields.
 * the wire format is simple enough that reading it directly is smaller than the
 * generated types would be, and it does not go stale when spotify adds fields.
 */
declare const WIRE_VARINT = 0;
declare const WIRE_FIXED64 = 1;
declare const WIRE_BYTES = 2;
declare const WIRE_FIXED32 = 5;
interface ProtobufField {
    field: number;
    wire: number;
    /** present for length-delimited fields. */
    bytes?: Buffer;
    /** present for varint and fixed-width fields. */
    value?: number;
}
/** builds a message body; fields must be appended in whatever order the caller wants. */
declare class ProtobufWriter {
    private readonly chunks;
    private tag;
    varint(field: number, value: number): this;
    bytes(field: number, value: Buffer | Uint8Array): this;
    string(field: number, value: string): this;
    /** nest another message under `field`. */
    message(field: number, body: ProtobufWriter | Buffer): this;
    private push;
    finish(): Buffer;
}
/**
 * split a message into its fields. unknown fields come back too, which is the
 * point: spotify adds them regularly and nothing here should care.
 */
declare const readFields: (buffer: Buffer) => ProtobufField[];
declare const messagesAt: (fields: ProtobufField[], field: number) => Buffer[];
declare const messageAt: (fields: ProtobufField[], field: number) => Buffer | undefined;
declare const varintAt: (fields: ProtobufField[], field: number) => number | undefined;
declare const stringAt: (fields: ProtobufField[], field: number) => string | undefined;

/**
 * shannon stream cipher — the one spotify's access point speaks.
 *
 * ported from the pure-javascript implementation by alexander kose
 * (https://github.com/twonky4/shannon, MIT), which is itself a port of felix
 * bruns' javascript port of the original c reference. vendored rather than
 * depended on: it is a single 0.0.1 release from 2019 with one maintainer, and a
 * cipher sitting in the authentication path is not somewhere to inherit an
 * unpatchable dependency. the upstream test vectors ship alongside it.
 *
 * the arithmetic below is deliberately unchanged from the reference. it relies
 * on javascript's 32-bit bitwise semantics throughout, including some habits
 * that look like mistakes and are not — see the notes at each one.
 */
declare class Shannon {
    /** working storage for the shift register. */
    private R;
    /** working storage for crc accumulation. */
    private CRC;
    /** saved register contents. */
    private initR;
    /** key dependent semi-constant. */
    private konst;
    /** encryption buffer. */
    private sbuf;
    /** partial word mac buffer. */
    private mbuf;
    /** number of part-word stream bits buffered. */
    private nbuf;
    constructor(key?: Buffer | Uint8Array | number[] | string);
    /** nonlinear transform of a word; two slightly different combinations. */
    private static sbox;
    private static sbox2;
    /** cycle the register and produce one output word in sbuf. */
    private cycle;
    /**
     * accumulate a crc of input words for the mac: 32 parallel crc-16s over the
     * ibm polynomial x^16 + x^15 + x^2 + 1.
     */
    private crcFunc;
    /** normal mac word processing: both the stream register and the crc. */
    private macFunc;
    private initState;
    private saveState;
    private reloadState;
    private addKey;
    private diffuse;
    /**
     * fold key material into the register, allowing a length that is not a
     * multiple of four. initialises the crc register as a side effect.
     */
    private loadKey;
    key(key: Buffer | Uint8Array | number[] | string): this;
    /** set the iv. spotify uses the packet sequence number. */
    nonce(nonce: Buffer | Uint8Array | number[] | string): this;
    /** xor keystream into the buffer. does not accumulate a mac. */
    stream(input: Buffer | Uint8Array | number[] | string): Buffer;
    /** accumulate words into the mac without encrypting them. */
    macOnly(input: Buffer | Uint8Array | number[] | string): Buffer;
    /** encrypt, accumulating the plaintext into the mac. */
    encrypt(input: Buffer | Uint8Array | number[] | string, length?: number): Buffer;
    /** decrypt, accumulating the recovered plaintext into the mac. */
    decrypt(input: Buffer | Uint8Array | number[] | string, length?: number): Buffer;
    /**
     * finish the mac and write it into a buffer of the requested length.
     *
     * trailing bytes are treated as encrypted zero bytes, so the plaintext zeros
     * are accumulated.
     */
    finish(size?: number | Buffer): Buffer;
}

declare const protobufPackage = "license_protocol";
declare enum LicenseType {
    STREAMING = 1,
    OFFLINE = 2,
    /** AUTOMATIC - License type decision is left to provider. */
    AUTOMATIC = 3,
    UNRECOGNIZED = -1
}
declare function licenseTypeFromJSON(object: any): LicenseType;
declare function licenseTypeToJSON(object: LicenseType): string;
declare enum PlatformVerificationStatus {
    /** PLATFORM_UNVERIFIED - The platform is not verified. */
    PLATFORM_UNVERIFIED = 0,
    /** PLATFORM_TAMPERED - Tampering detected on the platform. */
    PLATFORM_TAMPERED = 1,
    /** PLATFORM_SOFTWARE_VERIFIED - The platform has been verified by means of software. */
    PLATFORM_SOFTWARE_VERIFIED = 2,
    /** PLATFORM_HARDWARE_VERIFIED - The platform has been verified by means of hardware (e.g. secure boot). */
    PLATFORM_HARDWARE_VERIFIED = 3,
    /** PLATFORM_NO_VERIFICATION - Platform verification was not performed. */
    PLATFORM_NO_VERIFICATION = 4,
    /**
     * PLATFORM_SECURE_STORAGE_SOFTWARE_VERIFIED - Platform and secure storage capability have been verified by means of
     * software.
     */
    PLATFORM_SECURE_STORAGE_SOFTWARE_VERIFIED = 5,
    UNRECOGNIZED = -1
}
declare function platformVerificationStatusFromJSON(object: any): PlatformVerificationStatus;
declare function platformVerificationStatusToJSON(object: PlatformVerificationStatus): string;
declare enum ProtocolVersion {
    VERSION_2_0 = 20,
    VERSION_2_1 = 21,
    VERSION_2_2 = 22,
    UNRECOGNIZED = -1
}
declare function protocolVersionFromJSON(object: any): ProtocolVersion;
declare function protocolVersionToJSON(object: ProtocolVersion): string;
declare enum HashAlgorithmProto {
    /**
     * HASH_ALGORITHM_UNSPECIFIED - Unspecified hash algorithm: SHA_256 shall be used for ECC based algorithms
     * and SHA_1 shall be used otherwise.
     */
    HASH_ALGORITHM_UNSPECIFIED = 0,
    HASH_ALGORITHM_SHA_1 = 1,
    HASH_ALGORITHM_SHA_256 = 2,
    HASH_ALGORITHM_SHA_384 = 3,
    UNRECOGNIZED = -1
}
declare function hashAlgorithmProtoFromJSON(object: any): HashAlgorithmProto;
declare function hashAlgorithmProtoToJSON(object: HashAlgorithmProto): string;
declare enum License_KeyContainer_KeyType {
    /** SIGNING - Exactly one key of this type must appear. */
    SIGNING = 1,
    /** CONTENT - Content key. */
    CONTENT = 2,
    /** KEY_CONTROL - Key control block for license renewals. No key. */
    KEY_CONTROL = 3,
    /** OPERATOR_SESSION - wrapped keys for auxiliary crypto operations. */
    OPERATOR_SESSION = 4,
    /** ENTITLEMENT - Entitlement keys. */
    ENTITLEMENT = 5,
    /** OEM_CONTENT - Partner-specific content key. */
    OEM_CONTENT = 6,
    UNRECOGNIZED = -1
}
declare function license_KeyContainer_KeyTypeFromJSON(object: any): License_KeyContainer_KeyType;
declare function license_KeyContainer_KeyTypeToJSON(object: License_KeyContainer_KeyType): string;
/**
 * The SecurityLevel enumeration allows the server to communicate the level
 * of robustness required by the client, in order to use the key.
 */
declare enum License_KeyContainer_SecurityLevel {
    /** SW_SECURE_CRYPTO - Software-based whitebox crypto is required. */
    SW_SECURE_CRYPTO = 1,
    /** SW_SECURE_DECODE - Software crypto and an obfuscated decoder is required. */
    SW_SECURE_DECODE = 2,
    /**
     * HW_SECURE_CRYPTO - The key material and crypto operations must be performed within a
     * hardware backed trusted execution environment.
     */
    HW_SECURE_CRYPTO = 3,
    /**
     * HW_SECURE_DECODE - The crypto and decoding of content must be performed within a hardware
     * backed trusted execution environment.
     */
    HW_SECURE_DECODE = 4,
    /**
     * HW_SECURE_ALL - The crypto, decoding and all handling of the media (compressed and
     * uncompressed) must be handled within a hardware backed trusted
     * execution environment.
     */
    HW_SECURE_ALL = 5,
    UNRECOGNIZED = -1
}
declare function license_KeyContainer_SecurityLevelFromJSON(object: any): License_KeyContainer_SecurityLevel;
declare function license_KeyContainer_SecurityLevelToJSON(object: License_KeyContainer_SecurityLevel): string;
/**
 * Indicates whether HDCP is required on digital outputs, and which
 * version should be used.
 */
declare enum License_KeyContainer_OutputProtection_HDCP {
    HDCP_NONE = 0,
    HDCP_V1 = 1,
    HDCP_V2 = 2,
    HDCP_V2_1 = 3,
    HDCP_V2_2 = 4,
    HDCP_V2_3 = 5,
    HDCP_NO_DIGITAL_OUTPUT = 255,
    UNRECOGNIZED = -1
}
declare function license_KeyContainer_OutputProtection_HDCPFromJSON(object: any): License_KeyContainer_OutputProtection_HDCP;
declare function license_KeyContainer_OutputProtection_HDCPToJSON(object: License_KeyContainer_OutputProtection_HDCP): string;
/** Indicate the CGMS setting to be inserted on analog output. */
declare enum License_KeyContainer_OutputProtection_CGMS {
    CGMS_NONE = 42,
    COPY_FREE = 0,
    COPY_ONCE = 2,
    COPY_NEVER = 3,
    UNRECOGNIZED = -1
}
declare function license_KeyContainer_OutputProtection_CGMSFromJSON(object: any): License_KeyContainer_OutputProtection_CGMS;
declare function license_KeyContainer_OutputProtection_CGMSToJSON(object: License_KeyContainer_OutputProtection_CGMS): string;
declare enum License_KeyContainer_OutputProtection_HdcpSrmRule {
    HDCP_SRM_RULE_NONE = 0,
    /**
     * CURRENT_SRM - In 'required_protection', this means most current SRM is required.
     * Update the SRM on the device. If update cannot happen,
     * do not allow the key.
     * In 'requested_protection', this means most current SRM is requested.
     * Update the SRM on the device. If update cannot happen,
     * allow use of the key anyway.
     */
    CURRENT_SRM = 1,
    UNRECOGNIZED = -1
}
declare function license_KeyContainer_OutputProtection_HdcpSrmRuleFromJSON(object: any): License_KeyContainer_OutputProtection_HdcpSrmRule;
declare function license_KeyContainer_OutputProtection_HdcpSrmRuleToJSON(object: License_KeyContainer_OutputProtection_HdcpSrmRule): string;
declare enum LicenseRequest_RequestType {
    NEW = 1,
    RENEWAL = 2,
    RELEASE = 3,
    UNRECOGNIZED = -1
}
declare function licenseRequest_RequestTypeFromJSON(object: any): LicenseRequest_RequestType;
declare function licenseRequest_RequestTypeToJSON(object: LicenseRequest_RequestType): string;
declare enum LicenseRequest_ContentIdentification_InitData_InitDataType {
    CENC = 1,
    WEBM = 2,
    UNRECOGNIZED = -1
}
declare function licenseRequest_ContentIdentification_InitData_InitDataTypeFromJSON(object: any): LicenseRequest_ContentIdentification_InitData_InitDataType;
declare function licenseRequest_ContentIdentification_InitData_InitDataTypeToJSON(object: LicenseRequest_ContentIdentification_InitData_InitDataType): string;
declare enum MetricData_MetricType {
    /** LATENCY - The time spent in the 'stage', specified in microseconds. */
    LATENCY = 1,
    /**
     * TIMESTAMP - The UNIX epoch timestamp at which the 'stage' was first accessed in
     * microseconds.
     */
    TIMESTAMP = 2,
    UNRECOGNIZED = -1
}
declare function metricData_MetricTypeFromJSON(object: any): MetricData_MetricType;
declare function metricData_MetricTypeToJSON(object: MetricData_MetricType): string;
declare enum SignedMessage_MessageType {
    LICENSE_REQUEST = 1,
    LICENSE = 2,
    ERROR_RESPONSE = 3,
    SERVICE_CERTIFICATE_REQUEST = 4,
    SERVICE_CERTIFICATE = 5,
    SUB_LICENSE = 6,
    CAS_LICENSE_REQUEST = 7,
    CAS_LICENSE = 8,
    EXTERNAL_LICENSE_REQUEST = 9,
    EXTERNAL_LICENSE = 10,
    UNRECOGNIZED = -1
}
declare function signedMessage_MessageTypeFromJSON(object: any): SignedMessage_MessageType;
declare function signedMessage_MessageTypeToJSON(object: SignedMessage_MessageType): string;
declare enum SignedMessage_SessionKeyType {
    UNDEFINED = 0,
    WRAPPED_AES_KEY = 1,
    EPHERMERAL_ECC_PUBLIC_KEY = 2,
    UNRECOGNIZED = -1
}
declare function signedMessage_SessionKeyTypeFromJSON(object: any): SignedMessage_SessionKeyType;
declare function signedMessage_SessionKeyTypeToJSON(object: SignedMessage_SessionKeyType): string;
declare enum ClientIdentification_TokenType {
    KEYBOX = 0,
    DRM_DEVICE_CERTIFICATE = 1,
    REMOTE_ATTESTATION_CERTIFICATE = 2,
    OEM_DEVICE_CERTIFICATE = 3,
    UNRECOGNIZED = -1
}
declare function clientIdentification_TokenTypeFromJSON(object: any): ClientIdentification_TokenType;
declare function clientIdentification_TokenTypeToJSON(object: ClientIdentification_TokenType): string;
declare enum ClientIdentification_ClientCapabilities_HdcpVersion {
    HDCP_NONE = 0,
    HDCP_V1 = 1,
    HDCP_V2 = 2,
    HDCP_V2_1 = 3,
    HDCP_V2_2 = 4,
    HDCP_V2_3 = 5,
    HDCP_NO_DIGITAL_OUTPUT = 255,
    UNRECOGNIZED = -1
}
declare function clientIdentification_ClientCapabilities_HdcpVersionFromJSON(object: any): ClientIdentification_ClientCapabilities_HdcpVersion;
declare function clientIdentification_ClientCapabilities_HdcpVersionToJSON(object: ClientIdentification_ClientCapabilities_HdcpVersion): string;
declare enum ClientIdentification_ClientCapabilities_CertificateKeyType {
    RSA_2048 = 0,
    RSA_3072 = 1,
    ECC_SECP256R1 = 2,
    ECC_SECP384R1 = 3,
    ECC_SECP521R1 = 4,
    UNRECOGNIZED = -1
}
declare function clientIdentification_ClientCapabilities_CertificateKeyTypeFromJSON(object: any): ClientIdentification_ClientCapabilities_CertificateKeyType;
declare function clientIdentification_ClientCapabilities_CertificateKeyTypeToJSON(object: ClientIdentification_ClientCapabilities_CertificateKeyType): string;
declare enum ClientIdentification_ClientCapabilities_AnalogOutputCapabilities {
    ANALOG_OUTPUT_UNKNOWN = 0,
    ANALOG_OUTPUT_NONE = 1,
    ANALOG_OUTPUT_SUPPORTED = 2,
    ANALOG_OUTPUT_SUPPORTS_CGMS_A = 3,
    UNRECOGNIZED = -1
}
declare function clientIdentification_ClientCapabilities_AnalogOutputCapabilitiesFromJSON(object: any): ClientIdentification_ClientCapabilities_AnalogOutputCapabilities;
declare function clientIdentification_ClientCapabilities_AnalogOutputCapabilitiesToJSON(object: ClientIdentification_ClientCapabilities_AnalogOutputCapabilities): string;
declare enum DrmCertificate_Type {
    /** ROOT - ProtoBestPractices: ignore. */
    ROOT = 0,
    DEVICE_MODEL = 1,
    DEVICE = 2,
    SERVICE = 3,
    PROVISIONER = 4,
    UNRECOGNIZED = -1
}
declare function drmCertificate_TypeFromJSON(object: any): DrmCertificate_Type;
declare function drmCertificate_TypeToJSON(object: DrmCertificate_Type): string;
declare enum DrmCertificate_ServiceType {
    UNKNOWN_SERVICE_TYPE = 0,
    LICENSE_SERVER_SDK = 1,
    LICENSE_SERVER_PROXY_SDK = 2,
    PROVISIONING_SDK = 3,
    CAS_PROXY_SDK = 4,
    UNRECOGNIZED = -1
}
declare function drmCertificate_ServiceTypeFromJSON(object: any): DrmCertificate_ServiceType;
declare function drmCertificate_ServiceTypeToJSON(object: DrmCertificate_ServiceType): string;
declare enum DrmCertificate_Algorithm {
    UNKNOWN_ALGORITHM = 0,
    RSA = 1,
    ECC_SECP256R1 = 2,
    ECC_SECP384R1 = 3,
    ECC_SECP521R1 = 4,
    UNRECOGNIZED = -1
}
declare function drmCertificate_AlgorithmFromJSON(object: any): DrmCertificate_Algorithm;
declare function drmCertificate_AlgorithmToJSON(object: DrmCertificate_Algorithm): string;
declare enum WidevinePsshData_Type {
    /** SINGLE - Single PSSH to be used to retrieve content keys. */
    SINGLE = 0,
    /** ENTITLEMENT - Primary PSSH used to retrieve entitlement keys. */
    ENTITLEMENT = 1,
    /** ENTITLED_KEY - Secondary PSSH containing entitled key(s). */
    ENTITLED_KEY = 2,
    UNRECOGNIZED = -1
}
declare function widevinePsshData_TypeFromJSON(object: any): WidevinePsshData_Type;
declare function widevinePsshData_TypeToJSON(object: WidevinePsshData_Type): string;
/** //////////////////////////  Deprecated Fields  //////////////////////////// */
declare enum WidevinePsshData_Algorithm {
    UNENCRYPTED = 0,
    AESCTR = 1,
    UNRECOGNIZED = -1
}
declare function widevinePsshData_AlgorithmFromJSON(object: any): WidevinePsshData_Algorithm;
declare function widevinePsshData_AlgorithmToJSON(object: WidevinePsshData_Algorithm): string;
/**
 * LicenseIdentification is propagated from LicenseRequest to License,
 * incrementing version with each iteration.
 */
interface LicenseIdentification {
    requestId: Buffer;
    sessionId: Buffer;
    purchaseId: Buffer;
    type: LicenseType;
    version: number;
    providerSessionToken: Buffer;
}
declare const LicenseIdentification: {
    encode(message: LicenseIdentification, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): LicenseIdentification;
    fromJSON(object: any): LicenseIdentification;
    toJSON(message: LicenseIdentification): unknown;
    fromPartial<I extends Exact<DeepPartial<LicenseIdentification>, I>>(object: I): LicenseIdentification;
};
interface License {
    id: LicenseIdentification | undefined;
    policy: License_Policy | undefined;
    key: License_KeyContainer[];
    /**
     * Time of the request in seconds (UTC) as set in
     * LicenseRequest.request_time.  If this time is not set in the request,
     * the local time at the license service is used in this field.
     */
    licenseStartTime: Long;
    remoteAttestationVerified: boolean;
    /** Client token generated by the content provider. Optional. */
    providerClientToken: Buffer;
    /**
     * 4cc code specifying the CENC protection scheme as defined in the CENC 3.0
     * specification. Propagated from Widevine PSSH box. Optional.
     */
    protectionScheme: number;
    /**
     * 8 byte verification field "HDCPDATA" followed by unsigned 32 bit minimum
     * HDCP SRM version (whether the version is for HDCP1 SRM or HDCP2 SRM
     * depends on client max_hdcp_version).
     * Additional details can be found in Widevine Modular DRM Security
     * Integration Guide for CENC.
     */
    srmRequirement: Buffer;
    /**
     * If present this contains a signed SRM file (either HDCP1 SRM or HDCP2 SRM
     * depending on client max_hdcp_version) that should be installed on the
     * client device.
     */
    srmUpdate: Buffer;
    /**
     * Indicates the status of any type of platform verification performed by the
     * server.
     */
    platformVerificationStatus: PlatformVerificationStatus;
    /** IDs of the groups for which keys are delivered in this license, if any. */
    groupIds: Buffer[];
}
declare const License: {
    encode(message: License, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): License;
    fromJSON(object: any): License;
    toJSON(message: License): unknown;
    fromPartial<I extends Exact<DeepPartial<License>, I>>(object: I): License;
};
interface License_Policy {
    /** Indicates that playback of the content is allowed. */
    canPlay: boolean;
    /**
     * Indicates that the license may be persisted to non-volatile
     * storage for offline use.
     */
    canPersist: boolean;
    /** Indicates that renewal of this license is allowed. */
    canRenew: boolean;
    /** Indicates the rental window. */
    rentalDurationSeconds: Long;
    /** Indicates the viewing window, once playback has begun. */
    playbackDurationSeconds: Long;
    /** Indicates the time window for this specific license. */
    licenseDurationSeconds: Long;
    /**
     * The window of time, in which playback is allowed to continue while
     * renewal is attempted, yet unsuccessful due to backend problems with
     * the license server.
     */
    renewalRecoveryDurationSeconds: Long;
    /**
     * All renewal requests for this license shall be directed to the
     * specified URL.
     */
    renewalServerUrl: string;
    /**
     * How many seconds after license_start_time, before renewal is first
     * attempted.
     */
    renewalDelaySeconds: Long;
    /**
     * Specifies the delay in seconds between subsequent license
     * renewal requests, in case of failure.
     */
    renewalRetryIntervalSeconds: Long;
    /**
     * Indicates that the license shall be sent for renewal when usage is
     * started.
     */
    renewWithUsage: boolean;
    /**
     * Indicates to client that license renewal and release requests ought to
     * include ClientIdentification (client_id).
     */
    alwaysIncludeClientId: boolean;
    /**
     * Duration of grace period before playback_duration_seconds (short window)
     * goes into effect. Optional.
     */
    playStartGracePeriodSeconds: Long;
    /**
     * Enables "soft enforcement" of playback_duration_seconds, letting the user
     * finish playback even if short window expires. Optional.
     */
    softEnforcePlaybackDuration: boolean;
    /**
     * Enables "soft enforcement" of rental_duration_seconds. Initial playback
     * must always start before rental duration expires.  In order to allow
     * subsequent playbacks to start after the rental duration expires,
     * soft_enforce_playback_duration must be true. Otherwise, subsequent
     * playbacks will not be allowed once rental duration expires. Optional.
     */
    softEnforceRentalDuration: boolean;
}
declare const License_Policy: {
    encode(message: License_Policy, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): License_Policy;
    fromJSON(object: any): License_Policy;
    toJSON(message: License_Policy): unknown;
    fromPartial<I extends Exact<DeepPartial<License_Policy>, I>>(object: I): License_Policy;
};
interface License_KeyContainer {
    id: Buffer;
    iv: Buffer;
    key: Buffer;
    type: License_KeyContainer_KeyType;
    level: License_KeyContainer_SecurityLevel;
    requiredProtection: License_KeyContainer_OutputProtection | undefined;
    /**
     * NOTE: Use of requested_protection is not recommended as it is only
     * supported on a small number of platforms.
     */
    requestedProtection: License_KeyContainer_OutputProtection | undefined;
    keyControl: License_KeyContainer_KeyControl | undefined;
    operatorSessionKeyPermissions: License_KeyContainer_OperatorSessionKeyPermissions | undefined;
    /**
     * Optional video resolution constraints. If the video resolution of the
     * content being decrypted/decoded falls within one of the specified ranges,
     * the optional required_protections may be applied. Otherwise an error will
     * be reported.
     * NOTE: Use of this feature is not recommended, as it is only supported on
     * a small number of platforms.
     */
    videoResolutionConstraints: License_KeyContainer_VideoResolutionConstraint[];
    /**
     * Optional flag to indicate the key must only be used if the client
     * supports anti rollback of the user table.  Content provider can query the
     * client capabilities to determine if the client support this feature.
     */
    antiRollbackUsageTable: boolean;
    /**
     * Optional not limited to commonly known track types such as SD, HD.
     * It can be some provider defined label to identify the track.
     */
    trackLabel: string;
}
declare const License_KeyContainer: {
    encode(message: License_KeyContainer, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): License_KeyContainer;
    fromJSON(object: any): License_KeyContainer;
    toJSON(message: License_KeyContainer): unknown;
    fromPartial<I extends Exact<DeepPartial<License_KeyContainer>, I>>(object: I): License_KeyContainer;
};
interface License_KeyContainer_KeyControl {
    /**
     * |key_control| is documented in:
     * Widevine Modular DRM Security Integration Guide for CENC
     * If present, the key control must be communicated to the secure
     * environment prior to any usage. This message is automatically generated
     * by the Widevine License Server SDK.
     */
    keyControlBlock: Buffer;
    iv: Buffer;
}
declare const License_KeyContainer_KeyControl: {
    encode(message: License_KeyContainer_KeyControl, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): License_KeyContainer_KeyControl;
    fromJSON(object: any): License_KeyContainer_KeyControl;
    toJSON(message: License_KeyContainer_KeyControl): unknown;
    fromPartial<I extends Exact<DeepPartial<License_KeyContainer_KeyControl>, I>>(object: I): License_KeyContainer_KeyControl;
};
interface License_KeyContainer_OutputProtection {
    hdcp: License_KeyContainer_OutputProtection_HDCP;
    cgmsFlags: License_KeyContainer_OutputProtection_CGMS;
    hdcpSrmRule: License_KeyContainer_OutputProtection_HdcpSrmRule;
    /** Optional requirement to indicate analog output is not allowed. */
    disableAnalogOutput: boolean;
    /** Optional requirement to indicate digital output is not allowed. */
    disableDigitalOutput: boolean;
}
declare const License_KeyContainer_OutputProtection: {
    encode(message: License_KeyContainer_OutputProtection, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): License_KeyContainer_OutputProtection;
    fromJSON(object: any): License_KeyContainer_OutputProtection;
    toJSON(message: License_KeyContainer_OutputProtection): unknown;
    fromPartial<I extends Exact<DeepPartial<License_KeyContainer_OutputProtection>, I>>(object: I): License_KeyContainer_OutputProtection;
};
interface License_KeyContainer_VideoResolutionConstraint {
    /** Minimum and maximum video resolutions in the range (height x width). */
    minResolutionPixels: number;
    maxResolutionPixels: number;
    /**
     * Optional output protection requirements for this range. If not
     * specified, the OutputProtection in the KeyContainer applies.
     */
    requiredProtection: License_KeyContainer_OutputProtection | undefined;
}
declare const License_KeyContainer_VideoResolutionConstraint: {
    encode(message: License_KeyContainer_VideoResolutionConstraint, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): License_KeyContainer_VideoResolutionConstraint;
    fromJSON(object: any): License_KeyContainer_VideoResolutionConstraint;
    toJSON(message: License_KeyContainer_VideoResolutionConstraint): unknown;
    fromPartial<I extends Exact<DeepPartial<License_KeyContainer_VideoResolutionConstraint>, I>>(object: I): License_KeyContainer_VideoResolutionConstraint;
};
interface License_KeyContainer_OperatorSessionKeyPermissions {
    /**
     * Permissions/key usage flags for operator service keys
     * (type = OPERATOR_SESSION).
     */
    allowEncrypt: boolean;
    allowDecrypt: boolean;
    allowSign: boolean;
    allowSignatureVerify: boolean;
}
declare const License_KeyContainer_OperatorSessionKeyPermissions: {
    encode(message: License_KeyContainer_OperatorSessionKeyPermissions, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): License_KeyContainer_OperatorSessionKeyPermissions;
    fromJSON(object: any): License_KeyContainer_OperatorSessionKeyPermissions;
    toJSON(message: License_KeyContainer_OperatorSessionKeyPermissions): unknown;
    fromPartial<I extends Exact<DeepPartial<License_KeyContainer_OperatorSessionKeyPermissions>, I>>(object: I): License_KeyContainer_OperatorSessionKeyPermissions;
};
interface LicenseRequest {
    /**
     * The client_id provides information authenticating the calling device.  It
     * contains the Widevine keybox token that was installed on the device at the
     * factory.  This field or encrypted_client_id below is required for a valid
     * license request, but both should never be present in the same request.
     */
    clientId: ClientIdentification | undefined;
    contentId: LicenseRequest_ContentIdentification | undefined;
    type: LicenseRequest_RequestType;
    /** Time of the request in seconds (UTC) as set by the client. */
    requestTime: Long;
    /** Old-style decimal-encoded string key control nonce. */
    keyControlNonceDeprecated: Buffer;
    protocolVersion: ProtocolVersion;
    /**
     * New-style uint32 key control nonce, please use instead of
     * key_control_nonce_deprecated.
     */
    keyControlNonce: number;
    /** Encrypted ClientIdentification message, used for privacy purposes. */
    encryptedClientId: EncryptedClientIdentification | undefined;
}
declare const LicenseRequest: {
    encode(message: LicenseRequest, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): LicenseRequest;
    fromJSON(object: any): LicenseRequest;
    toJSON(message: LicenseRequest): unknown;
    fromPartial<I extends Exact<DeepPartial<LicenseRequest>, I>>(object: I): LicenseRequest;
};
interface LicenseRequest_ContentIdentification {
    /** Exactly one of these must be present. */
    widevinePsshData?: LicenseRequest_ContentIdentification_WidevinePsshData | undefined;
    webmKeyId?: LicenseRequest_ContentIdentification_WebmKeyId | undefined;
    existingLicense?: LicenseRequest_ContentIdentification_ExistingLicense | undefined;
    initData?: LicenseRequest_ContentIdentification_InitData | undefined;
}
declare const LicenseRequest_ContentIdentification: {
    encode(message: LicenseRequest_ContentIdentification, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): LicenseRequest_ContentIdentification;
    fromJSON(object: any): LicenseRequest_ContentIdentification;
    toJSON(message: LicenseRequest_ContentIdentification): unknown;
    fromPartial<I extends Exact<DeepPartial<LicenseRequest_ContentIdentification>, I>>(object: I): LicenseRequest_ContentIdentification;
};
interface LicenseRequest_ContentIdentification_WidevinePsshData {
    psshData: Buffer[];
    licenseType: LicenseType;
    /** Opaque, client-specified. */
    requestId: Buffer;
}
declare const LicenseRequest_ContentIdentification_WidevinePsshData: {
    encode(message: LicenseRequest_ContentIdentification_WidevinePsshData, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): LicenseRequest_ContentIdentification_WidevinePsshData;
    fromJSON(object: any): LicenseRequest_ContentIdentification_WidevinePsshData;
    toJSON(message: LicenseRequest_ContentIdentification_WidevinePsshData): unknown;
    fromPartial<I extends Exact<DeepPartial<LicenseRequest_ContentIdentification_WidevinePsshData>, I>>(object: I): LicenseRequest_ContentIdentification_WidevinePsshData;
};
interface LicenseRequest_ContentIdentification_WebmKeyId {
    header: Buffer;
    licenseType: LicenseType;
    /** Opaque, client-specified. */
    requestId: Buffer;
}
declare const LicenseRequest_ContentIdentification_WebmKeyId: {
    encode(message: LicenseRequest_ContentIdentification_WebmKeyId, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): LicenseRequest_ContentIdentification_WebmKeyId;
    fromJSON(object: any): LicenseRequest_ContentIdentification_WebmKeyId;
    toJSON(message: LicenseRequest_ContentIdentification_WebmKeyId): unknown;
    fromPartial<I extends Exact<DeepPartial<LicenseRequest_ContentIdentification_WebmKeyId>, I>>(object: I): LicenseRequest_ContentIdentification_WebmKeyId;
};
interface LicenseRequest_ContentIdentification_ExistingLicense {
    licenseId: LicenseIdentification | undefined;
    secondsSinceStarted: Long;
    secondsSinceLastPlayed: Long;
    sessionUsageTableEntry: Buffer;
}
declare const LicenseRequest_ContentIdentification_ExistingLicense: {
    encode(message: LicenseRequest_ContentIdentification_ExistingLicense, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): LicenseRequest_ContentIdentification_ExistingLicense;
    fromJSON(object: any): LicenseRequest_ContentIdentification_ExistingLicense;
    toJSON(message: LicenseRequest_ContentIdentification_ExistingLicense): unknown;
    fromPartial<I extends Exact<DeepPartial<LicenseRequest_ContentIdentification_ExistingLicense>, I>>(object: I): LicenseRequest_ContentIdentification_ExistingLicense;
};
interface LicenseRequest_ContentIdentification_InitData {
    initDataType: LicenseRequest_ContentIdentification_InitData_InitDataType;
    initData: Buffer;
    licenseType: LicenseType;
    requestId: Buffer;
}
declare const LicenseRequest_ContentIdentification_InitData: {
    encode(message: LicenseRequest_ContentIdentification_InitData, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): LicenseRequest_ContentIdentification_InitData;
    fromJSON(object: any): LicenseRequest_ContentIdentification_InitData;
    toJSON(message: LicenseRequest_ContentIdentification_InitData): unknown;
    fromPartial<I extends Exact<DeepPartial<LicenseRequest_ContentIdentification_InitData>, I>>(object: I): LicenseRequest_ContentIdentification_InitData;
};
interface MetricData {
    /** 'stage' that is currently processing the SignedMessage.  Required. */
    stageName: string;
    /** metric and associated value. */
    metricData: MetricData_TypeValue[];
}
declare const MetricData: {
    encode(message: MetricData, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): MetricData;
    fromJSON(object: any): MetricData;
    toJSON(message: MetricData): unknown;
    fromPartial<I extends Exact<DeepPartial<MetricData>, I>>(object: I): MetricData;
};
interface MetricData_TypeValue {
    type: MetricData_MetricType;
    /**
     * The value associated with 'type'.  For example if type == LATENCY, the
     * value would be the time in microseconds spent in this 'stage'.
     */
    value: Long;
}
declare const MetricData_TypeValue: {
    encode(message: MetricData_TypeValue, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): MetricData_TypeValue;
    fromJSON(object: any): MetricData_TypeValue;
    toJSON(message: MetricData_TypeValue): unknown;
    fromPartial<I extends Exact<DeepPartial<MetricData_TypeValue>, I>>(object: I): MetricData_TypeValue;
};
interface VersionInfo {
    /**
     * License SDK version reported by the Widevine License SDK. This field
     * is populated automatically by the SDK.
     */
    licenseSdkVersion: string;
    /**
     * Version of the service hosting the license SDK. This field is optional.
     * It may be provided by the hosting service.
     */
    licenseServiceVersion: string;
}
declare const VersionInfo: {
    encode(message: VersionInfo, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): VersionInfo;
    fromJSON(object: any): VersionInfo;
    toJSON(message: VersionInfo): unknown;
    fromPartial<I extends Exact<DeepPartial<VersionInfo>, I>>(object: I): VersionInfo;
};
interface SignedMessage {
    type: SignedMessage_MessageType;
    msg: Buffer;
    /**
     * Required field that contains the signature of the bytes of msg.
     * For license requests, the signing algorithm is determined by the
     * certificate contained in the request.
     * For license responses, the signing algorithm is HMAC with signing key based
     * on |session_key|.
     */
    signature: Buffer;
    /**
     * If populated, the contents of this field will be signaled by the
     * |session_key_type| type. If the |session_key_type| is WRAPPED_AES_KEY the
     * key is the bytes of an encrypted AES key. If the |session_key_type| is
     * EPHERMERAL_ECC_PUBLIC_KEY the field contains the bytes of an RFC5208 ASN1
     * serialized ECC public key.
     */
    sessionKey: Buffer;
    /**
     * Remote attestation data which will be present in the initial license
     * request for ChromeOS client devices operating in verified mode. Remote
     * attestation challenge data is |msg| field above. Optional.
     */
    remoteAttestation: Buffer;
    metricData: MetricData[];
    /**
     * Version information from the SDK and license service. This information is
     * provided in the license response.
     */
    serviceVersionInfo: VersionInfo | undefined;
    /**
     * Optional field that contains the algorithm type used to generate the
     * session_key and signature in a LICENSE message.
     */
    sessionKeyType: SignedMessage_SessionKeyType;
    /**
     * The core message is the simple serialization of fields used by OEMCrypto.
     * This field was introduced in OEMCrypto API v16.
     */
    oemcryptoCoreMessage: Buffer;
}
declare const SignedMessage: {
    encode(message: SignedMessage, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): SignedMessage;
    fromJSON(object: any): SignedMessage;
    toJSON(message: SignedMessage): unknown;
    fromPartial<I extends Exact<DeepPartial<SignedMessage>, I>>(object: I): SignedMessage;
};
/** ClientIdentification message used to authenticate the client device. */
interface ClientIdentification {
    /** Type of factory-provisioned device root of trust. Optional. */
    type: ClientIdentification_TokenType;
    /** Factory-provisioned device root of trust. Required. */
    token: Buffer;
    /** Optional client information name/value pairs. */
    clientInfo: ClientIdentification_NameValue[];
    /** Client token generated by the content provider. Optional. */
    providerClientToken: Buffer;
    /**
     * Number of licenses received by the client to which the token above belongs.
     * Only present if client_token is specified.
     */
    licenseCounter: number;
    /** List of non-baseline client capabilities. */
    clientCapabilities: ClientIdentification_ClientCapabilities | undefined;
    /** Serialized VmpData message. Optional. */
    vmpData: Buffer;
    /** Optional field that may contain additional provisioning credentials. */
    deviceCredentials: ClientIdentification_ClientCredentials[];
}
declare const ClientIdentification: {
    encode(message: ClientIdentification, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): ClientIdentification;
    fromJSON(object: any): ClientIdentification;
    toJSON(message: ClientIdentification): unknown;
    fromPartial<I extends Exact<DeepPartial<ClientIdentification>, I>>(object: I): ClientIdentification;
};
interface ClientIdentification_NameValue {
    name: string;
    value: string;
}
declare const ClientIdentification_NameValue: {
    encode(message: ClientIdentification_NameValue, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): ClientIdentification_NameValue;
    fromJSON(object: any): ClientIdentification_NameValue;
    toJSON(message: ClientIdentification_NameValue): unknown;
    fromPartial<I extends Exact<DeepPartial<ClientIdentification_NameValue>, I>>(object: I): ClientIdentification_NameValue;
};
/**
 * Capabilities which not all clients may support. Used for the license
 * exchange protocol only.
 */
interface ClientIdentification_ClientCapabilities {
    clientToken: boolean;
    sessionToken: boolean;
    videoResolutionConstraints: boolean;
    maxHdcpVersion: ClientIdentification_ClientCapabilities_HdcpVersion;
    oemCryptoApiVersion: number;
    /**
     * Client has hardware support for protecting the usage table, such as
     * storing the generation number in secure memory.  For Details, see:
     * Widevine Modular DRM Security Integration Guide for CENC
     */
    antiRollbackUsageTable: boolean;
    /** The client shall report |srm_version| if available. */
    srmVersion: number;
    /**
     * A device may have SRM data, and report a version, but may not be capable
     * of updating SRM data.
     */
    canUpdateSrm: boolean;
    supportedCertificateKeyType: ClientIdentification_ClientCapabilities_CertificateKeyType[];
    analogOutputCapabilities: ClientIdentification_ClientCapabilities_AnalogOutputCapabilities;
    canDisableAnalogOutput: boolean;
    /**
     * Clients can indicate a performance level supported by OEMCrypto.
     * This will allow applications and providers to choose an appropriate
     * quality of content to serve. Currently defined tiers are
     * 1 (low), 2 (medium) and 3 (high). Any other value indicates that
     * the resource rating is unavailable or reporting erroneous values
     * for that device. For details see,
     * Widevine Modular DRM Security Integration Guide for CENC
     */
    resourceRatingTier: number;
}
declare const ClientIdentification_ClientCapabilities: {
    encode(message: ClientIdentification_ClientCapabilities, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): ClientIdentification_ClientCapabilities;
    fromJSON(object: any): ClientIdentification_ClientCapabilities;
    toJSON(message: ClientIdentification_ClientCapabilities): unknown;
    fromPartial<I extends Exact<DeepPartial<ClientIdentification_ClientCapabilities>, I>>(object: I): ClientIdentification_ClientCapabilities;
};
interface ClientIdentification_ClientCredentials {
    type: ClientIdentification_TokenType;
    token: Buffer;
}
declare const ClientIdentification_ClientCredentials: {
    encode(message: ClientIdentification_ClientCredentials, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): ClientIdentification_ClientCredentials;
    fromJSON(object: any): ClientIdentification_ClientCredentials;
    toJSON(message: ClientIdentification_ClientCredentials): unknown;
    fromPartial<I extends Exact<DeepPartial<ClientIdentification_ClientCredentials>, I>>(object: I): ClientIdentification_ClientCredentials;
};
/**
 * EncryptedClientIdentification message used to hold ClientIdentification
 * messages encrypted for privacy purposes.
 */
interface EncryptedClientIdentification {
    /**
     * Provider ID for which the ClientIdentifcation is encrypted (owner of
     * service certificate).
     */
    providerId: string;
    /**
     * Serial number for the service certificate for which ClientIdentification is
     * encrypted.
     */
    serviceCertificateSerialNumber: Buffer;
    /**
     * Serialized ClientIdentification message, encrypted with the privacy key
     * using AES-128-CBC with PKCS#5 padding.
     */
    encryptedClientId: Buffer;
    /** Initialization vector needed to decrypt encrypted_client_id. */
    encryptedClientIdIv: Buffer;
    /** AES-128 privacy key, encrypted with the service public key using RSA-OAEP. */
    encryptedPrivacyKey: Buffer;
}
declare const EncryptedClientIdentification: {
    encode(message: EncryptedClientIdentification, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): EncryptedClientIdentification;
    fromJSON(object: any): EncryptedClientIdentification;
    toJSON(message: EncryptedClientIdentification): unknown;
    fromPartial<I extends Exact<DeepPartial<EncryptedClientIdentification>, I>>(object: I): EncryptedClientIdentification;
};
/**
 * DRM certificate definition for user devices, intermediate, service, and root
 * certificates.
 */
interface DrmCertificate {
    /** Type of certificate. Required. */
    type: DrmCertificate_Type;
    /**
     * 128-bit globally unique serial number of certificate.
     * Value is 0 for root certificate. Required.
     */
    serialNumber: Buffer;
    /** POSIX time, in seconds, when the certificate was created. Required. */
    creationTimeSeconds: number;
    /**
     * POSIX time, in seconds, when the certificate should expire. Value of zero
     * denotes indefinite expiry time. For more information on limited lifespan
     * DRM certificates see (go/limited-lifespan-drm-certificates).
     */
    expirationTimeSeconds: number;
    /** Device public key. PKCS#1 ASN.1 DER-encoded. Required. */
    publicKey: Buffer;
    /**
     * Widevine system ID for the device. Required for intermediate and
     * user device certificates.
     */
    systemId: number;
    /**
     * Deprecated field, which used to indicate whether the device was a test
     * (non-production) device. The test_device field in ProvisionedDeviceInfo
     * below should be observed instead.
     *
     * @deprecated
     */
    testDeviceDeprecated: boolean;
    /**
     * Service identifier (web origin) for the provider which owns the
     * certificate. Required for service and provisioner certificates.
     */
    providerId: string;
    /**
     * This field is used only when type = SERVICE to specify which SDK uses
     * service certificate. This repeated field is treated as a set. A certificate
     * may be used for the specified service SDK if the appropriate ServiceType
     * is specified in this field.
     */
    serviceTypes: DrmCertificate_ServiceType[];
    /**
     * Required. The algorithm field contains the curve used to create the
     * |public_key| if algorithm is one of the ECC types.
     * The |algorithm| is used for both to determine the if the certificate is ECC
     * or RSA. The |algorithm| also specifies the parameters that were used to
     * create |public_key| and are used to create an ephemeral session key.
     */
    algorithm: DrmCertificate_Algorithm;
    /**
     * Optional. May be present in DEVICE certificate types. This is the root
     * of trust identifier that holds an encrypted value that identifies the
     * keybox or other root of trust that was used to provision a DEVICE drm
     * certificate.
     */
    rotId: Buffer;
    /**
     * Optional. May be present in devices that explicitly support dual keys. When
     * present the |public_key| is used for verification of received license
     * request messages.
     */
    encryptionKey: DrmCertificate_EncryptionKey | undefined;
}
declare const DrmCertificate: {
    encode(message: DrmCertificate, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): DrmCertificate;
    fromJSON(object: any): DrmCertificate;
    toJSON(message: DrmCertificate): unknown;
    fromPartial<I extends Exact<DeepPartial<DrmCertificate>, I>>(object: I): DrmCertificate;
};
interface DrmCertificate_EncryptionKey {
    /** Device public key. PKCS#1 ASN.1 DER-encoded. Required. */
    publicKey: Buffer;
    /**
     * Required. The algorithm field contains the curve used to create the
     * |public_key| if algorithm is one of the ECC types.
     * The |algorithm| is used for both to determine the if the certificate is
     * ECC or RSA. The |algorithm| also specifies the parameters that were used
     * to create |public_key| and are used to create an ephemeral session key.
     */
    algorithm: DrmCertificate_Algorithm;
}
declare const DrmCertificate_EncryptionKey: {
    encode(message: DrmCertificate_EncryptionKey, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): DrmCertificate_EncryptionKey;
    fromJSON(object: any): DrmCertificate_EncryptionKey;
    toJSON(message: DrmCertificate_EncryptionKey): unknown;
    fromPartial<I extends Exact<DeepPartial<DrmCertificate_EncryptionKey>, I>>(object: I): DrmCertificate_EncryptionKey;
};
/** DrmCertificate signed by a higher (CA) DRM certificate. */
interface SignedDrmCertificate {
    /** Serialized certificate. Required. */
    drmCertificate: Buffer;
    /**
     * Signature of certificate. Signed with root or intermediate
     * certificate specified below. Required.
     */
    signature: Buffer;
    /** SignedDrmCertificate used to sign this certificate. */
    signer: SignedDrmCertificate | undefined;
    /** Optional field that indicates the hash algorithm used in signature scheme. */
    hashAlgorithm: HashAlgorithmProto;
}
declare const SignedDrmCertificate: {
    encode(message: SignedDrmCertificate, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): SignedDrmCertificate;
    fromJSON(object: any): SignedDrmCertificate;
    toJSON(message: SignedDrmCertificate): unknown;
    fromPartial<I extends Exact<DeepPartial<SignedDrmCertificate>, I>>(object: I): SignedDrmCertificate;
};
interface WidevinePsshData {
    /**
     * Entitlement or content key IDs. Can onnly present in SINGLE or ENTITLEMENT
     * PSSHs. May be repeated to facilitate delivery of multiple keys in a
     * single license. Cannot be used in conjunction with content_id or
     * group_ids, which are the preferred mechanism.
     */
    keyIds: Buffer[];
    /**
     * Content identifier which may map to multiple entitlement or content key
     * IDs to facilitate the delivery of multiple keys in a single license.
     * Cannot be present in conjunction with key_ids, but if used must be in all
     * PSSHs.
     */
    contentId: Buffer;
    /**
     * Crypto period index, for media using key rotation. Always corresponds to
     * The content key period. This means that if using entitlement licensing
     * the ENTITLED_KEY PSSHs will have sequential crypto_period_index's, whereas
     * the ENTITELEMENT PSSHs will have gaps in the sequence. Required if doing
     * key rotation.
     */
    cryptoPeriodIndex: number;
    /**
     * Protection scheme identifying the encryption algorithm. The protection
     * scheme is represented as a uint32 value. The uint32 contains 4 bytes each
     * representing a single ascii character in one of the 4CC protection scheme
     * values. To be deprecated in favor of signaling from content.
     * 'cenc' (AES-CTR) protection_scheme = 0x63656E63,
     * 'cbc1' (AES-CBC) protection_scheme = 0x63626331,
     * 'cens' (AES-CTR pattern encryption) protection_scheme = 0x63656E73,
     * 'cbcs' (AES-CBC pattern encryption) protection_scheme = 0x63626373.
     */
    protectionScheme: number;
    /**
     * Optional. For media using key rotation, this represents the duration
     * of each crypto period in seconds.
     */
    cryptoPeriodSeconds: number;
    /** Type of PSSH. Required if not SINGLE. */
    type: WidevinePsshData_Type;
    /** Key sequence for Widevine-managed keys. Optional. */
    keySequence: number;
    /**
     * Group identifiers for all groups to which the content belongs. This can
     * be used to deliver licenses to unlock multiple titles / channels.
     * Optional, and may only be present in ENTITLEMENT and ENTITLED_KEY PSSHs, and
     * not in conjunction with key_ids.
     */
    groupIds: Buffer[];
    /**
     * Copy/copies of the content key used to decrypt the media stream in which
     * the PSSH box is embedded, each wrapped with a different entitlement key.
     * May also contain sub-licenses to support devices with OEMCrypto 13 or
     * older. May be repeated if using group entitlement keys. Present only in
     * PSSHs of type ENTITLED_KEY.
     */
    entitledKeys: WidevinePsshData_EntitledKey[];
    /**
     * Video feature identifier, which is used in conjunction with |content_id|
     * to determine the set of keys to be returned in the license. Cannot be
     * present in conjunction with |key_ids|.
     * Current values are "HDR".
     */
    videoFeature: string;
    /** @deprecated */
    algorithm: WidevinePsshData_Algorithm;
    /**
     * Content provider name.
     *
     * @deprecated
     */
    provider: string;
    /**
     * Track type. Acceptable values are SD, HD and AUDIO. Used to
     * differentiate content keys used by an asset.
     *
     * @deprecated
     */
    trackType: string;
    /**
     * The name of a registered policy to be used for this asset.
     *
     * @deprecated
     */
    policy: string;
    /**
     * Optional protected context for group content. The grouped_license is a
     * serialized SignedMessage.
     *
     * @deprecated
     */
    groupedLicense: Buffer;
}
declare const WidevinePsshData: {
    encode(message: WidevinePsshData, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): WidevinePsshData;
    fromJSON(object: any): WidevinePsshData;
    toJSON(message: WidevinePsshData): unknown;
    fromPartial<I extends Exact<DeepPartial<WidevinePsshData>, I>>(object: I): WidevinePsshData;
};
interface WidevinePsshData_EntitledKey {
    /** ID of entitlement key used for wrapping |key|. */
    entitlementKeyId: Buffer;
    /** ID of the entitled key. */
    keyId: Buffer;
    /** Wrapped key. Required. */
    key: Buffer;
    /** IV used for wrapping |key|. Required. */
    iv: Buffer;
    /** Size of entitlement key used for wrapping |key|. */
    entitlementKeySizeBytes: number;
}
declare const WidevinePsshData_EntitledKey: {
    encode(message: WidevinePsshData_EntitledKey, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): WidevinePsshData_EntitledKey;
    fromJSON(object: any): WidevinePsshData_EntitledKey;
    toJSON(message: WidevinePsshData_EntitledKey): unknown;
    fromPartial<I extends Exact<DeepPartial<WidevinePsshData_EntitledKey>, I>>(object: I): WidevinePsshData_EntitledKey;
};
/** File Hashes for Verified Media Path (VMP) support. */
interface FileHashes {
    signer: Buffer;
    signatures: FileHashes_Signature[];
}
declare const FileHashes: {
    encode(message: FileHashes, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): FileHashes;
    fromJSON(object: any): FileHashes;
    toJSON(message: FileHashes): unknown;
    fromPartial<I extends Exact<DeepPartial<FileHashes>, I>>(object: I): FileHashes;
};
interface FileHashes_Signature {
    filename: string;
    /** 0 - release, 1 - testing */
    testSigning: boolean;
    SHA512Hash: Buffer;
    /** 0 for dlls, 1 for exe, this is field 3 in file */
    mainExe: boolean;
    signature: Buffer;
}
declare const FileHashes_Signature: {
    encode(message: FileHashes_Signature, writer?: _m0.Writer): _m0.Writer;
    decode(input: _m0.Reader | Uint8Array, length?: number): FileHashes_Signature;
    fromJSON(object: any): FileHashes_Signature;
    toJSON(message: FileHashes_Signature): unknown;
    fromPartial<I extends Exact<DeepPartial<FileHashes_Signature>, I>>(object: I): FileHashes_Signature;
};
type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;
type DeepPartial<T> = T extends Builtin ? T : T extends Long ? string | number | Long : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>> : T extends {} ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : Partial<T>;
type KeysOfUnion<T> = T extends T ? keyof T : never;
type Exact<P, I extends P> = P extends Builtin ? P : P & {
    [K in keyof P]: Exact<P[K], I[K]>;
} & {
    [K in Exclude<keyof I, KeysOfUnion<P>>]: never;
};

type KeyContainer = {
    type: License_KeyContainer_KeyType;
    kid: string;
    key: string;
};
type ContentDecryptionModule = {
    privateKey: Buffer;
    identifierBlob: Buffer;
};
declare class Session {
    private _devicePrivateKey;
    private _identifierBlob;
    private _identifier;
    private _pssh;
    private _rawLicenseRequest?;
    constructor(contentDecryptionModule: ContentDecryptionModule, pssh: Buffer);
    createLicenseRequest(): Buffer;
    parseLicense(rawLicense: Buffer): KeyContainer[];
    private _parsePSSH;
    private _generateIdentifier;
    get pssh(): Buffer;
}

/** AudioFile.Format, from librespot's metadata.proto. */
declare const AUDIO_FILE_FORMATS: {
    readonly 0: "OGG_VORBIS_96";
    readonly 1: "OGG_VORBIS_160";
    readonly 2: "OGG_VORBIS_320";
    readonly 3: "MP3_256";
    readonly 4: "MP3_320";
    readonly 5: "MP3_160";
    readonly 6: "MP3_96";
    readonly 7: "MP3_160_ENC";
    readonly 8: "AAC_24";
    readonly 9: "AAC_48";
    readonly 16: "FLAC_FLAC";
    readonly 18: "XHE_AAC_24";
    readonly 19: "XHE_AAC_16";
    readonly 20: "XHE_AAC_12";
    readonly 22: "FLAC_FLAC_24BIT";
};
type AudioFileFormat = (typeof AUDIO_FILE_FORMATS)[keyof typeof AUDIO_FILE_FORMATS];
interface SpotifyAudioFile {
    /** hex, 20 bytes — what storage-resolve and the audio key are keyed on. */
    fileId: string;
    /** the enum name when known, otherwise the raw number as a string. */
    format: string;
    formatId: number;
    /** bits per second, as the service reports it. */
    bitrate?: number;
}
/**
 * turn `original_audio.uuid` from track metadata into the entity uri the
 * extended-metadata service wants: `spotify:audio:<base62 of the uuid>`.
 */
declare const audioUriFromUuid: (uuid: string) => string;
declare const buildRequest: (entityUri: string) => Buffer;
declare const parseResponse: (body: Buffer) => SpotifyAudioFile[];
/**
 * ask which audio files exist for a track.
 *
 * spotify removed the `file` list from track metadata entirely — it is not
 * empty for some regions, it is gone from both the json and the protobuf
 * projections — and moved it here. anything that still reads `metadata.file`
 * finds nothing and concludes the track is unavailable.
 */
declare const fetchAudioFiles: (http: HttpClient, accessToken: string, audioUuid: string) => Promise<SpotifyAudioFile[]>;

/**
 * @generated from message spotify.login5.v3.ClientInfo
 */
type ClientInfo = Message<"spotify.login5.v3.ClientInfo"> & {
    /**
     * @generated from field: string client_id = 1;
     */
    clientId: string;
    /**
     * @generated from field: string device_id = 2;
     */
    deviceId: string;
};

/**
 * @generated from message spotify.login5.v3.UserInfo
 */
type UserInfo = Message<"spotify.login5.v3.UserInfo"> & {
    /**
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * @generated from field: string email = 2;
     */
    email: string;
    /**
     * @generated from field: bool email_verified = 3;
     */
    emailVerified: boolean;
    /**
     * @generated from field: string birthdate = 4;
     */
    birthdate: string;
    /**
     * @generated from field: spotify.login5.v3.UserInfo.Gender gender = 5;
     */
    gender: UserInfo_Gender;
    /**
     * @generated from field: string phone_number = 6;
     */
    phoneNumber: string;
    /**
     * @generated from field: bool phone_number_verified = 7;
     */
    phoneNumberVerified: boolean;
    /**
     * @generated from field: bool email_already_registered = 8;
     */
    emailAlreadyRegistered: boolean;
};
/**
 * @generated from enum spotify.login5.v3.UserInfo.Gender
 */
declare enum UserInfo_Gender {
    /**
     * @generated from enum value: UNKNOWN = 0;
     */
    UNKNOWN = 0,
    /**
     * @generated from enum value: MALE = 1;
     */
    MALE = 1,
    /**
     * @generated from enum value: FEMALE = 2;
     */
    FEMALE = 2,
    /**
     * @generated from enum value: NEUTRAL = 3;
     */
    NEUTRAL = 3
}

/**
 * @generated from message spotify.login5.v3.challenges.CodeChallenge
 */
type CodeChallenge = Message<"spotify.login5.v3.challenges.CodeChallenge"> & {
    /**
     * @generated from field: spotify.login5.v3.challenges.CodeChallenge.Method method = 1;
     */
    method: CodeChallenge_Method;
    /**
     * @generated from field: int32 code_length = 2;
     */
    codeLength: number;
    /**
     * @generated from field: int32 expires_in = 3;
     */
    expiresIn: number;
    /**
     * @generated from field: string canonical_phone_number = 4;
     */
    canonicalPhoneNumber: string;
};
/**
 * @generated from enum spotify.login5.v3.challenges.CodeChallenge.Method
 */
declare enum CodeChallenge_Method {
    /**
     * @generated from enum value: UNKNOWN = 0;
     */
    UNKNOWN = 0,
    /**
     * @generated from enum value: SMS = 1;
     */
    SMS = 1
}
/**
 * @generated from message spotify.login5.v3.challenges.CodeSolution
 */
type CodeSolution = Message<"spotify.login5.v3.challenges.CodeSolution"> & {
    /**
     * @generated from field: string code = 1;
     */
    code: string;
};

/**
 * @generated from message spotify.login5.v3.challenges.HashcashChallenge
 */
type HashcashChallenge = Message<"spotify.login5.v3.challenges.HashcashChallenge"> & {
    /**
     * @generated from field: bytes prefix = 1;
     */
    prefix: Uint8Array;
    /**
     * @generated from field: int32 length = 2;
     */
    length: number;
};
/**
 * @generated from message spotify.login5.v3.challenges.HashcashSolution
 */
type HashcashSolution = Message<"spotify.login5.v3.challenges.HashcashSolution"> & {
    /**
     * @generated from field: bytes suffix = 1;
     */
    suffix: Uint8Array;
    /**
     * @generated from field: google.protobuf.Duration duration = 2;
     */
    duration?: Duration;
};

/**
 * @generated from message spotify.login5.v3.credentials.StoredCredential
 */
type StoredCredential = Message<"spotify.login5.v3.credentials.StoredCredential"> & {
    /**
     * @generated from field: string username = 1;
     */
    username: string;
    /**
     * @generated from field: bytes data = 2;
     */
    data: Uint8Array;
};
/**
 * @generated from message spotify.login5.v3.credentials.Password
 */
type Password = Message<"spotify.login5.v3.credentials.Password"> & {
    /**
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * @generated from field: string password = 2;
     */
    password: string;
    /**
     * @generated from field: bytes padding = 3;
     */
    padding: Uint8Array;
};
/**
 * @generated from message spotify.login5.v3.credentials.FacebookAccessToken
 */
type FacebookAccessToken = Message<"spotify.login5.v3.credentials.FacebookAccessToken"> & {
    /**
     * @generated from field: string fb_uid = 1;
     */
    fbUid: string;
    /**
     * @generated from field: string access_token = 2;
     */
    accessToken: string;
};
/**
 * @generated from message spotify.login5.v3.credentials.OneTimeToken
 */
type OneTimeToken = Message<"spotify.login5.v3.credentials.OneTimeToken"> & {
    /**
     * @generated from field: string token = 1;
     */
    token: string;
};
/**
 * @generated from message spotify.login5.v3.credentials.ParentChildCredential
 */
type ParentChildCredential = Message<"spotify.login5.v3.credentials.ParentChildCredential"> & {
    /**
     * @generated from field: string child_id = 1;
     */
    childId: string;
    /**
     * @generated from field: spotify.login5.v3.credentials.StoredCredential parent_stored_credential = 2;
     */
    parentStoredCredential?: StoredCredential;
};
/**
 * @generated from message spotify.login5.v3.credentials.AppleSignInCredential
 */
type AppleSignInCredential = Message<"spotify.login5.v3.credentials.AppleSignInCredential"> & {
    /**
     * @generated from field: string auth_code = 1;
     */
    authCode: string;
    /**
     * @generated from field: string redirect_uri = 2;
     */
    redirectUri: string;
    /**
     * @generated from field: string bundle_id = 3;
     */
    bundleId: string;
};
/**
 * @generated from message spotify.login5.v3.credentials.SamsungSignInCredential
 */
type SamsungSignInCredential = Message<"spotify.login5.v3.credentials.SamsungSignInCredential"> & {
    /**
     * @generated from field: string auth_code = 1;
     */
    authCode: string;
    /**
     * @generated from field: string redirect_uri = 2;
     */
    redirectUri: string;
    /**
     * @generated from field: string id_token = 3;
     */
    idToken: string;
    /**
     * @generated from field: string token_endpoint_url = 4;
     */
    tokenEndpointUrl: string;
};
/**
 * @generated from message spotify.login5.v3.credentials.GoogleSignInCredential
 */
type GoogleSignInCredential = Message<"spotify.login5.v3.credentials.GoogleSignInCredential"> & {
    /**
     * @generated from field: string auth_code = 1;
     */
    authCode: string;
    /**
     * @generated from field: string redirect_uri = 2;
     */
    redirectUri: string;
};

/**
 * @generated from message spotify.login5.v3.identifiers.PhoneNumber
 */
type PhoneNumber = Message<"spotify.login5.v3.identifiers.PhoneNumber"> & {
    /**
     * @generated from field: string number = 1;
     */
    number: string;
    /**
     * @generated from field: string iso_country_code = 2;
     */
    isoCountryCode: string;
    /**
     * @generated from field: string country_calling_code = 3;
     */
    countryCallingCode: string;
};

/**
 * @generated from message spotify.login5.v3.Challenges
 */
type Challenges = Message<"spotify.login5.v3.Challenges"> & {
    /**
     * @generated from field: repeated spotify.login5.v3.Challenge challenges = 1;
     */
    challenges: Challenge[];
};
/**
 * @generated from message spotify.login5.v3.Challenge
 */
type Challenge = Message<"spotify.login5.v3.Challenge"> & {
    /**
     * @generated from oneof spotify.login5.v3.Challenge.challenge
     */
    challenge: {
        /**
         * @generated from field: spotify.login5.v3.challenges.HashcashChallenge hashcash = 1;
         */
        value: HashcashChallenge;
        case: "hashcash";
    } | {
        /**
         * @generated from field: spotify.login5.v3.challenges.CodeChallenge code = 2;
         */
        value: CodeChallenge;
        case: "code";
    } | {
        case: undefined;
        value?: undefined;
    };
};
/**
 * @generated from message spotify.login5.v3.ChallengeSolutions
 */
type ChallengeSolutions = Message<"spotify.login5.v3.ChallengeSolutions"> & {
    /**
     * @generated from field: repeated spotify.login5.v3.ChallengeSolution solutions = 1;
     */
    solutions: ChallengeSolution[];
};
/**
 * @generated from message spotify.login5.v3.ChallengeSolution
 */
type ChallengeSolution = Message<"spotify.login5.v3.ChallengeSolution"> & {
    /**
     * @generated from oneof spotify.login5.v3.ChallengeSolution.solution
     */
    solution: {
        /**
         * @generated from field: spotify.login5.v3.challenges.HashcashSolution hashcash = 1;
         */
        value: HashcashSolution;
        case: "hashcash";
    } | {
        /**
         * @generated from field: spotify.login5.v3.challenges.CodeSolution code = 2;
         */
        value: CodeSolution;
        case: "code";
    } | {
        case: undefined;
        value?: undefined;
    };
};
/**
 * @generated from message spotify.login5.v3.LoginRequest
 */
type LoginRequest = Message<"spotify.login5.v3.LoginRequest"> & {
    /**
     * @generated from field: spotify.login5.v3.ClientInfo client_info = 1;
     */
    clientInfo?: ClientInfo;
    /**
     * @generated from field: bytes login_context = 2;
     */
    loginContext: Uint8Array;
    /**
     * @generated from field: spotify.login5.v3.ChallengeSolutions challenge_solutions = 3;
     */
    challengeSolutions?: ChallengeSolutions;
    /**
     * @generated from oneof spotify.login5.v3.LoginRequest.login_method
     */
    loginMethod: {
        /**
         * @generated from field: spotify.login5.v3.credentials.StoredCredential stored_credential = 100;
         */
        value: StoredCredential;
        case: "storedCredential";
    } | {
        /**
         * @generated from field: spotify.login5.v3.credentials.Password password = 101;
         */
        value: Password;
        case: "password";
    } | {
        /**
         * @generated from field: spotify.login5.v3.credentials.FacebookAccessToken facebook_access_token = 102;
         */
        value: FacebookAccessToken;
        case: "facebookAccessToken";
    } | {
        /**
         * @generated from field: spotify.login5.v3.identifiers.PhoneNumber phone_number = 103;
         */
        value: PhoneNumber;
        case: "phoneNumber";
    } | {
        /**
         * @generated from field: spotify.login5.v3.credentials.OneTimeToken one_time_token = 104;
         */
        value: OneTimeToken;
        case: "oneTimeToken";
    } | {
        /**
         * @generated from field: spotify.login5.v3.credentials.ParentChildCredential parent_child_credential = 105;
         */
        value: ParentChildCredential;
        case: "parentChildCredential";
    } | {
        /**
         * @generated from field: spotify.login5.v3.credentials.AppleSignInCredential apple_sign_in_credential = 106;
         */
        value: AppleSignInCredential;
        case: "appleSignInCredential";
    } | {
        /**
         * @generated from field: spotify.login5.v3.credentials.SamsungSignInCredential samsung_sign_in_credential = 107;
         */
        value: SamsungSignInCredential;
        case: "samsungSignInCredential";
    } | {
        /**
         * @generated from field: spotify.login5.v3.credentials.GoogleSignInCredential google_sign_in_credential = 108;
         */
        value: GoogleSignInCredential;
        case: "googleSignInCredential";
    } | {
        case: undefined;
        value?: undefined;
    };
};
/**
 * @generated from message spotify.login5.v3.LoginOk
 */
type LoginOk = Message<"spotify.login5.v3.LoginOk"> & {
    /**
     * @generated from field: string username = 1;
     */
    username: string;
    /**
     * @generated from field: string access_token = 2;
     */
    accessToken: string;
    /**
     * @generated from field: bytes stored_credential = 3;
     */
    storedCredential: Uint8Array;
    /**
     * @generated from field: int32 access_token_expires_in = 4;
     */
    accessTokenExpiresIn: number;
};
/**
 * @generated from message spotify.login5.v3.LoginResponse
 */
type LoginResponse = Message<"spotify.login5.v3.LoginResponse"> & {
    /**
     * @generated from field: repeated spotify.login5.v3.LoginResponse.Warnings warnings = 4;
     */
    warnings: LoginResponse_Warnings[];
    /**
     * @generated from field: bytes login_context = 5;
     */
    loginContext: Uint8Array;
    /**
     * @generated from field: string identifier_token = 6;
     */
    identifierToken: string;
    /**
     * @generated from field: spotify.login5.v3.UserInfo user_info = 7;
     */
    userInfo?: UserInfo;
    /**
     * @generated from oneof spotify.login5.v3.LoginResponse.response
     */
    response: {
        /**
         * @generated from field: spotify.login5.v3.LoginOk ok = 1;
         */
        value: LoginOk;
        case: "ok";
    } | {
        /**
         * @generated from field: spotify.login5.v3.LoginError error = 2;
         */
        value: LoginError;
        case: "error";
    } | {
        /**
         * @generated from field: spotify.login5.v3.Challenges challenges = 3;
         */
        value: Challenges;
        case: "challenges";
    } | {
        case: undefined;
        value?: undefined;
    };
};
/**
 * @generated from enum spotify.login5.v3.LoginResponse.Warnings
 */
declare enum LoginResponse_Warnings {
    /**
     * @generated from enum value: UNKNOWN_WARNING = 0;
     */
    UNKNOWN_WARNING = 0,
    /**
     * @generated from enum value: DEPRECATED_PROTOCOL_VERSION = 1;
     */
    DEPRECATED_PROTOCOL_VERSION = 1
}
/**
 * @generated from enum spotify.login5.v3.LoginError
 */
declare enum LoginError {
    /**
     * @generated from enum value: UNKNOWN_ERROR = 0;
     */
    UNKNOWN_ERROR = 0,
    /**
     * @generated from enum value: INVALID_CREDENTIALS = 1;
     */
    INVALID_CREDENTIALS = 1,
    /**
     * @generated from enum value: BAD_REQUEST = 2;
     */
    BAD_REQUEST = 2,
    /**
     * @generated from enum value: UNSUPPORTED_LOGIN_PROTOCOL = 3;
     */
    UNSUPPORTED_LOGIN_PROTOCOL = 3,
    /**
     * @generated from enum value: TIMEOUT = 4;
     */
    TIMEOUT = 4,
    /**
     * @generated from enum value: UNKNOWN_IDENTIFIER = 5;
     */
    UNKNOWN_IDENTIFIER = 5,
    /**
     * @generated from enum value: TOO_MANY_ATTEMPTS = 6;
     */
    TOO_MANY_ATTEMPTS = 6,
    /**
     * @generated from enum value: INVALID_PHONENUMBER = 7;
     */
    INVALID_PHONENUMBER = 7,
    /**
     * @generated from enum value: TRY_AGAIN_LATER = 8;
     */
    TRY_AGAIN_LATER = 8
}

interface SpotifyAuthLoginViaPasswordOptions {
    clientInfo?: ClientInfo;
    username: string;
    password: string;
    http?: HttpClient;
}
interface SpotifyAuthLoginViaStoredCredentialOptions {
    clientInfo?: ClientInfo;
    username?: string;
    storedCredential: Uint8Array;
    http?: HttpClient;
}
interface SpotifyAuthOptions {
    loginResponse: LoginResponse;
    clientInfo?: ClientInfo;
    /** http tuning (proxy, timeouts, retries) reused for every renewal. */
    http?: HttpClient | HttpClientOptions;
    /**
     * renew this many ms before the token actually expires, so an in-flight request
     * never races the expiry. defaults to 60s.
     */
    expirySkewMs?: number;
}
interface SpotifyCredentials {
    accessToken: string;
    storedCredential: string;
    username: string;
    clientInfo: ClientInfo;
    /** epoch ms at which the access token stops being valid. */
    expiresAt: number;
}
interface ChallengeSolve {
    suffix: Uint8Array;
    ctr: number;
}
/**
 * headless spotify session built on login5. holds an access token, knows when it
 * expires, and renews itself from the stored credential on demand.
 *
 * renewal is lazy and single-flight: callers await {@link getAccessToken} and the
 * first one to find the token stale performs the refresh while everyone else
 * awaits the same promise. no background timers, nothing to leak.
 */
declare class SpotifyAuth {
    static LOGIN5_V3_LOGIN_URL: string;
    static LOGIN5_HEADERS: {
        'user-agent': string;
    };
    static SPOTIFY_CLIENT_ID: string;
    static sendLogin5(data: Uint8Array, headers?: Record<string, string>, http?: HttpClient): Promise<Uint8Array>;
    static solveHashcash(prefix: Uint8Array, length: number, random: Uint8Array): ChallengeSolve;
    static solveChallenges(loginContext: Uint8Array, challenges: Challenge[]): ChallengeSolution[];
    static generateClientInfo(): ClientInfo;
    static sendLoginRequest(loginRequest: LoginRequest, http?: HttpClient): Promise<LoginResponse>;
    /** turn a non-ok login5 response into a typed error with a readable reason. */
    private static assertOk;
    static loginViaPassword(opts: SpotifyAuthLoginViaPasswordOptions): Promise<LoginResponse>;
    static loginViaStoredCredential(opts: SpotifyAuthLoginViaStoredCredentialOptions): Promise<LoginResponse>;
    static fromLoginPassword(username: string, password: string, options?: Omit<SpotifyAuthOptions, 'loginResponse'>): Promise<SpotifyAuth>;
    static fromStoredCredential(storedCredential: Uint8Array | string, options?: Omit<SpotifyAuthOptions, 'loginResponse'>): Promise<SpotifyAuth>;
    private clientInfo;
    private storedCredential;
    private accessToken;
    private username;
    private expiresAt;
    private readonly expirySkewMs;
    private readonly http;
    /** in-flight renewal shared by every concurrent caller. */
    private renewal;
    constructor(opts: SpotifyAuthOptions);
    /**
     * login5 reports lifetime in seconds. it has been observed to come back as 0 on
     * some responses, so fall back to spotify's usual one-hour window rather than
     * treating the fresh token as already dead.
     */
    private static expiryFrom;
    get exportedCredentials(): SpotifyCredentials;
    /** true once the token is within the skew window of expiring. */
    get isExpired(): boolean;
    /** ms until renewal is due; 0 when it is already due. */
    get expiresInMs(): number;
    /**
     * the only token accessor callers should use. renews transparently when stale,
     * and collapses concurrent renewals into one login5 round trip.
     */
    getAccessToken(): Promise<string>;
    private renew;
    /**
     * exchange the stored credential for a fresh access token (and a fresh stored
     * credential — spotify rotates it). prefer {@link getAccessToken}, which only
     * calls this when the token is actually stale.
     */
    updateStoredCredential(): Promise<this>;
}

declare const widevineIdentifierBlob: Buffer;
declare const widevinePrivateKey: Buffer;

interface SpotifyDecryptor {
    decrypt: (key: string, data: Buffer) => Promise<Buffer>;
}

interface SpotifyDecryptorFFmpegOptions {
    /** where intermediate files land. defaults to the os temp dir. */
    tmpFolder?: string;
    /** kill ffmpeg if it has not finished within this many ms. defaults to 120s. */
    timeoutMs?: number;
    /** override the bundled ffmpeg-static binary. */
    binary?: string;
}
/**
 * decrypts widevine-protected mp4 audio by handing the content key to ffmpeg and
 * remuxing to a plain container.
 *
 * ffmpeg cannot write mp4 to a pipe (it needs to seek back and patch the moov
 * atom), so output goes to a temp file that is always removed — on success, on
 * failure, and on timeout.
 */
declare class SpotifyDecryptorFFmpeg implements SpotifyDecryptor {
    readonly tmpFolder: string;
    readonly timeoutMs: number;
    readonly binary: string | null;
    constructor(options?: string | SpotifyDecryptorFFmpegOptions);
    decrypt(key: string, data: Buffer): Promise<Buffer>;
    private run;
}

type SpotifyAudioType = 'track' | 'episode';
/**
 * formats tried in order when the caller does not pin one explicitly.
 *
 * mp4 is gone: spotify stopped offering the widevine-protected variants these
 * used to default to, and now serves ogg/aac/flac instead. 320 first because it
 * is the best lossy tier, flac last because it is an order of magnitude larger.
 */
declare const DEFAULT_FORMAT_PREFERENCE: readonly ["OGG_VORBIS_320", "OGG_VORBIS_160", "OGG_VORBIS_96", "AAC_24", "FLAC_FLAC"];
interface SpotifyDownloadOptions {
    /** a bare 22-char id, or an `open.spotify.com` link. */
    input: string;
    type?: SpotifyAudioType;
    /** a single format, or a preference list tried in order. */
    format?: string | readonly string[];
    /** renew the access token before starting, even if it still looks valid. */
    forceAccessToken?: boolean;
}
/**
 * anything that can hand over a currently-valid access token.
 *
 * {@link SpotifyAuth} satisfies this, and so does a caller holding an oauth
 * refresh token: the internal `spclient` surface accepts a first-party bearer
 * token regardless of how it was obtained, so the downloader has no business
 * insisting on a login5 session.
 */
interface SpotifyTokenProvider {
    getAccessToken(): Promise<string>;
    /** optional: only a login5 session can force a renewal on demand. */
    updateStoredCredential?(): Promise<unknown>;
}
interface SpotifyDownloaderOptions {
    decryptor?: SpotifyDecryptor;
    /** http tuning for metadata/license/cdn calls. inherits the auth proxy if omitted. */
    http?: HttpClient | HttpClientOptions;
}
interface SpotifyMetadata {
    name?: string;
    /**
     * the content identifier the audio file list is keyed on.
     *
     * this replaced the old `file` array, which spotify no longer returns in
     * either the json or the protobuf projection of track metadata.
     */
    original_audio?: {
        uuid: string;
        format?: string;
    };
}
interface SpotifyDownloadResult {
    id: string;
    gid: string;
    type: SpotifyAudioType;
    format: string;
    /** decrypted, playable audio. */
    track: Buffer;
    /** the raw encrypted payload as served by the cdn. */
    encrypted: Buffer;
    decryptionKey: string;
    streamUrl: string;
}
/**
 * resolves a track/episode to its encrypted cdn payload, obtains a widevine
 * content key, and hands both to a decryptor.
 *
 * every request pulls the token from {@link SpotifyAuth.getAccessToken}, so an
 * expired session renews itself mid-download instead of failing the call.
 */
declare class SpotifyDownloader {
    private readonly auth;
    static base62: Base62;
    static idToGid(id: string): string;
    static extractId(link: string): {
        type: SpotifyAudioType;
        id: string;
    } | null;
    /** parse a bare id or an open.spotify.com link into `[{ id, type }, gid]`. */
    static inputParse(input: string, type?: SpotifyAudioType): [{
        id: string;
        type: SpotifyAudioType;
    }, string];
    readonly decryptor: SpotifyDecryptor;
    private readonly http;
    constructor(auth: SpotifyTokenProvider, decryptorOrOptions?: SpotifyDecryptor | SpotifyDownloaderOptions);
    /** authorization header with a token guaranteed fresh at call time. */
    private authHeaders;
    fetchMetadata(gid: string, type?: SpotifyAudioType): Promise<SpotifyMetadata>;
    fetchPssh(fileId: string): Promise<Buffer>;
    fetchLicense(body: ArrayBuffer | Buffer): Promise<ArrayBuffer>;
    fetchStreamUrl(fileId: string): Promise<string>;
    /** pick the first available file matching the caller's format preference. */
    static selectAudioFile(files: SpotifyAudioFile[], preference: readonly string[]): SpotifyAudioFile;
    /**
     * every audio file spotify offers for a track: metadata for the content id,
     * then the extended-metadata service for the files themselves.
     */
    resolveAudioFiles(input: string, type?: SpotifyAudioType): Promise<SpotifyAudioFile[]>;
    download({ input, type, format, forceAccessToken }: SpotifyDownloadOptions): Promise<SpotifyDownloadResult>;
}

export { AES_CMAC, AUDIO_FILE_FORMATS, type AudioFileFormat, AudioKeyRequiredError, AuthError, Base62, ClientIdentification, ClientIdentification_ClientCapabilities, ClientIdentification_ClientCapabilities_AnalogOutputCapabilities, ClientIdentification_ClientCapabilities_CertificateKeyType, ClientIdentification_ClientCapabilities_HdcpVersion, ClientIdentification_ClientCredentials, ClientIdentification_NameValue, ClientIdentification_TokenType, type ContentDecryptionModule, DEFAULT_FORMAT_PREFERENCE, DecryptError, type DeepPartial, DownloadError, DrmCertificate, DrmCertificate_Algorithm, DrmCertificate_EncryptionKey, DrmCertificate_ServiceType, DrmCertificate_Type, EncryptedClientIdentification, type Exact, FileHashes, FileHashes_Signature, HashAlgorithmProto, HttpClient, type HttpClientOptions, HttpError, type HttpRequestOptions, type KeyContainer, License, LicenseIdentification, LicenseRequest, LicenseRequest_ContentIdentification, LicenseRequest_ContentIdentification_ExistingLicense, LicenseRequest_ContentIdentification_InitData, LicenseRequest_ContentIdentification_InitData_InitDataType, LicenseRequest_ContentIdentification_WebmKeyId, LicenseRequest_ContentIdentification_WidevinePsshData, LicenseRequest_RequestType, LicenseType, License_KeyContainer, License_KeyContainer_KeyControl, License_KeyContainer_KeyType, License_KeyContainer_OperatorSessionKeyPermissions, License_KeyContainer_OutputProtection, License_KeyContainer_OutputProtection_CGMS, License_KeyContainer_OutputProtection_HDCP, License_KeyContainer_OutputProtection_HdcpSrmRule, License_KeyContainer_SecurityLevel, License_KeyContainer_VideoResolutionConstraint, License_Policy, MetricData, MetricData_MetricType, MetricData_TypeValue, PlatformVerificationStatus, type ProtobufField, ProtobufWriter, ProtocolVersion, RespotifyError, Session, Shannon, SignedDrmCertificate, SignedMessage, SignedMessage_MessageType, SignedMessage_SessionKeyType, type SpotifyAudioFile, type SpotifyAudioType, SpotifyAuth, type SpotifyAuthLoginViaPasswordOptions, type SpotifyAuthLoginViaStoredCredentialOptions, type SpotifyAuthOptions, type SpotifyCredentials, type SpotifyDecryptor, SpotifyDecryptorFFmpeg, type SpotifyDecryptorFFmpegOptions, type SpotifyDownloadOptions, type SpotifyDownloadResult, SpotifyDownloader, type SpotifyDownloaderOptions, type SpotifyMetadata, type SpotifyTokenProvider, TimeoutError, TokenExpiredError, VersionInfo, WIRE_BYTES, WIRE_FIXED32, WIRE_FIXED64, WIRE_VARINT, WidevinePsshData, WidevinePsshData_Algorithm, WidevinePsshData_EntitledKey, WidevinePsshData_Type, audioUriFromUuid, buildRequest as buildAudioFilesRequest, clientIdentification_ClientCapabilities_AnalogOutputCapabilitiesFromJSON, clientIdentification_ClientCapabilities_AnalogOutputCapabilitiesToJSON, clientIdentification_ClientCapabilities_CertificateKeyTypeFromJSON, clientIdentification_ClientCapabilities_CertificateKeyTypeToJSON, clientIdentification_ClientCapabilities_HdcpVersionFromJSON, clientIdentification_ClientCapabilities_HdcpVersionToJSON, clientIdentification_TokenTypeFromJSON, clientIdentification_TokenTypeToJSON, defaultHttpClient, drmCertificate_AlgorithmFromJSON, drmCertificate_AlgorithmToJSON, drmCertificate_ServiceTypeFromJSON, drmCertificate_ServiceTypeToJSON, drmCertificate_TypeFromJSON, drmCertificate_TypeToJSON, fetchAudioFiles, hashAlgorithmProtoFromJSON, hashAlgorithmProtoToJSON, licenseRequest_ContentIdentification_InitData_InitDataTypeFromJSON, licenseRequest_ContentIdentification_InitData_InitDataTypeToJSON, licenseRequest_RequestTypeFromJSON, licenseRequest_RequestTypeToJSON, licenseTypeFromJSON, licenseTypeToJSON, license_KeyContainer_KeyTypeFromJSON, license_KeyContainer_KeyTypeToJSON, license_KeyContainer_OutputProtection_CGMSFromJSON, license_KeyContainer_OutputProtection_CGMSToJSON, license_KeyContainer_OutputProtection_HDCPFromJSON, license_KeyContainer_OutputProtection_HDCPToJSON, license_KeyContainer_OutputProtection_HdcpSrmRuleFromJSON, license_KeyContainer_OutputProtection_HdcpSrmRuleToJSON, license_KeyContainer_SecurityLevelFromJSON, license_KeyContainer_SecurityLevelToJSON, messageAt, messagesAt, metricData_MetricTypeFromJSON, metricData_MetricTypeToJSON, parseResponse as parseAudioFilesResponse, platformVerificationStatusFromJSON, platformVerificationStatusToJSON, protobufPackage, protocolVersionFromJSON, protocolVersionToJSON, readFields, signedMessage_MessageTypeFromJSON, signedMessage_MessageTypeToJSON, signedMessage_SessionKeyTypeFromJSON, signedMessage_SessionKeyTypeToJSON, stringAt, varintAt, widevineIdentifierBlob, widevinePrivateKey, widevinePsshData_AlgorithmFromJSON, widevinePsshData_AlgorithmToJSON, widevinePsshData_TypeFromJSON, widevinePsshData_TypeToJSON };
