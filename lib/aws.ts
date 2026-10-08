import {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { aws } from './config';
import type { Output } from './http';

function credentials() {
  return aws.accessKeyId && aws.secretAccessKey
    ? { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey }
    : undefined; // fall back to the default provider chain (env / instance role)
}

const g = globalThis as unknown as { __ptDdb?: DynamoDBClient; __ptDdbLegacy?: DynamoDBClient; __ptS3?: S3Client };

/** Client used by common-ajax.php / dynamodb_upload.php ($AWS_REGION). */
export function dynamodb(): DynamoDBClient {
  return (g.__ptDdb ??= new DynamoDBClient({ region: aws.region, credentials: credentials() }));
}

/** Client used by upload_dynamodb.php and humanchain_dynamodb/ (hardcoded us-east-1). */
export function dynamodbLegacy(): DynamoDBClient {
  return (g.__ptDdbLegacy ??= new DynamoDBClient({ region: aws.legacyRegion, credentials: credentials() }));
}

export function s3(): S3Client {
  return (g.__ptS3 ??= new S3Client({ region: aws.regionSouth, credentials: credentials() }));
}

/** functions.php tableExists(): other errors propagate. */
export async function tableExists(client: DynamoDBClient, tableName: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (e) {
    if (e instanceof ResourceNotFoundException || (e as any)?.name === 'ResourceNotFoundException') return false;
    throw e;
  }
}

/** functions.php createTable(): echoes progress text into the response, as PHP did. */
export async function createTable(client: DynamoDBClient, tableName: string, out: Output) {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      }),
    );
    out.echo(`Table ${tableName} is being created...\n`);
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: tableName });
    out.echo(`Table ${tableName} has been created successfully!\n`);
  } catch (e) {
    out.echo(`Error creating table: ${(e as Error).message}\n`);
  }
}

/** Raw-attribute flattening used by the PHP code: is_array($v) ? reset($v) : $v */
export function firstValue(av: any): any {
  if (av && typeof av === 'object') {
    for (const k of Object.keys(av)) if (av[k] !== undefined) return av[k];
    return null;
  }
  return av;
}

export function flattenItem(item: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(item ?? {})) out[k] = firstValue(v);
  return out;
}

/** Strips the SDK's $metadata so JSON output only has the item maps. */
export function errMessage(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}
