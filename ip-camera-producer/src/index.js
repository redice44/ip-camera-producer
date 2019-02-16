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

const main = async () => {
  await ensureBucket(S3_BUCKET);
  const brokerConnection = await setupConnection(rabbitMQConnectionString, topic);

  await imageProcedure(brokerConnection, IP_CAMERA_URL, S3_BUCKET);
  process.exit(0);
};

const imageProcedure = async (brokerConnection, imageUrl, bucket) => {
  const timestamp = moment().format('x');
  try {
    const img = await retrieveImage(imageUrl);
    await storeImage(img, bucket, `${timestamp}.jpeg`);
    await sendMessage(brokerConnection, bucket, `${timestamp}.jpeg`);
  } catch (error) {
    console.log(error);
  }
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

const ensureBucket = async (bucket) => {
  try {
    await s3.headBucket({ Bucket: bucket }).promise();
  } catch (error) {
    if (error.code === 'NotFound') {
      await s3.createBucket({ Bucket: bucket }).promise();
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
