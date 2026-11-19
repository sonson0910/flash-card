// Unit tests must never reach a real Google Cloud project. Outside an emulator run, point the
// Admin SDK at a key file that does not exist and at the demo project, so a call that a test
// forgot to mock fails on this machine instead of using the developer's own gcloud login.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = '/nonexistent/unit-tests-use-no-cloud-account';
  process.env.GCLOUD_PROJECT = 'demo-lingoflash';
  process.env.GOOGLE_CLOUD_PROJECT = 'demo-lingoflash';
}
