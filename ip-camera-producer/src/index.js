const AWS = require('aws-sdk');
const rp = require('request-promise');
const moment = require('moment');
const TopicConnector = require('@redice44/rabbitmq-topic-routing-schema');
const { images: topic } = require('@redice44/rabbitmq-topic-schemas');

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_ENDPOINT,
  S3_BUCKET,
  POLL_INTERVAL,
  IP_CAMERA_URL,
  LIST_DELIM,
  LIST_MANIFEST,
  LIST_PREFIX,
  LIST_PARTITION_NAME,
  LIST_PARTITIONS,
  LIST_PARTITION_SIZE,
  RABBITMQ_USER,
  RABBITMQ_PASS,
  RABBITMQ_URL
} = process.env;
const s3 = new AWS.S3({
  apiVersion: '2006-03-01',
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  endpoint: AWS_ENDPOINT,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});
const rabbitMQConnectionString = {
  user: RABBITMQ_USER,
  pass: RABBITMQ_PASS,
  url: RABBITMQ_URL
};
const partitionInfo = {
  tail: 0,
  head: 0,
  size: 0
};

const main = async () => {
  const manifestKey = `${LIST_PREFIX}${LIST_DELIM}${LIST_MANIFEST}`;
  const manifest = await ensureBucket(manifestKey);
  const brokerConnection = await setupConnection(rabbitMQConnectionString, topic);
  partitionInfo.head = (manifest.tail - 1) % LIST_PARTITIONS;
  await clearPartition(partitionInfo.head);
  partitionInfo.tail = manifest.tail;

  setInterval(imageProcedure, POLL_INTERVAL, brokerConnection);
};

const imageProcedure = async (brokerConnection) => {
  if (partitionInfo.size + 1 > LIST_PARTITION_SIZE) {
    partitionInfo.size = 0;
    partitionInfo.head = (partitionInfo.head + 1) % LIST_PARTITIONS;
    if (partitionInfo.head === partitionInfo.tail) {
      await clearPartition(partitionInfo.head);
      // Update manifest
      partitionInfo.tail = (partitionInfo.tail + 1) % LIST_PARTITIONS;
    }
  }
  const key = `${LIST_PREFIX}${LIST_DELIM}${LIST_PARTITION_NAME}-${partitionInfo.head}${LIST_DELIM}${moment().format('x')}`;
  try {
    console.log(`\n=== ${key} ===`);
    console.log('Pulling Image');
    partitionInfo.size++;
    const img = await retrieveImage(IP_CAMERA_URL);
    console.log('Saving Image');
    await storeImage(img, S3_BUCKET, `${key}.jpeg`);
    console.log('Sending Message');
    await sendMessage(brokerConnection, S3_BUCKET, `${key}.jpeg`);
  } catch (error) {
    console.log(error);
  }
};

const clearPartition = async (partitionIndex) => {
  const prefix = `${LIST_PREFIX}${LIST_DELIM}${LIST_PARTITION_NAME}-${partitionIndex}`;
  console.log(`\n=== Clearing Partition: ${prefix} ===`);
  const images = await s3.listObjectsV2({
    Bucket: S3_BUCKET,
    Prefix: prefix
  }).promise();
  const imagesToDelete = images.Contents.map(image => ({ Key: image.Key }));
  console.log(`Deleting ${imagesToDelete.length} images`);
  await s3.deleteObjects({
    Bucket: S3_BUCKET,
    Delete: { Objects: imagesToDelete }
  }).promise();
  console.log(`=== Done ===`);
};

const sendMessage = async (brokerConnection, bucket, key) => {
  const exchange = {
    location: 'canalParkingLot',
    sourceType: 'raw',
    format: 'jpeg'
  };
  const message = { bucket, key };
  await brokerConnection.publishToTopic(
    exchange,
    JSON.stringify(message),
    { timestamp: +moment() }
  );
};

const storeImage = (img, bucket, key) =>
  s3.putObject({
    Bucket: bucket,
    Key: key,
    Body: img
  }).promise();

const retrieveImage = (url) => rp.get({ url, encoding: null });

const ensureBucket = async (manifestKey) => {
  try {
    await s3.headBucket({ Bucket: S3_BUCKET }).promise();
    const manifest = await s3.getObject({
      Bucket: S3_BUCKET,
      Key: manifestKey
    }).promise();
    return JSON.parse(manifest.Body);
  } catch (error) {
    if (error.code === 'NotFound') {
      const manifest = { tail: 1 };
      await s3.createBucket({ Bucket: S3_BUCKET }).promise();
      await s3.putObject({
        Bucket: S3_BUCKET,
        Key: manifestKey,
        Body: JSON.stringify(manifest)
      }).promise();
      return manifest;
    } else {
      console.log(error);
      process.exit(1);
    }
  }
};
  
const setupConnection = async (connectionString, topic) => {
  const { name, schema } = topic;
  const connection = new TopicConnector(connectionString, name, schema);
  await connection.connectWithRetry();
  await connection.createTopic();
  return connection;
};

main();
