'use strict';
const { Share, Alert, Platform } = require('react-native');

const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
};

async function requestPermissionsAsync() {
  return { status: PermissionStatus.GRANTED, granted: true };
}

async function getPermissionsAsync() {
  return { status: PermissionStatus.GRANTED, granted: true };
}

async function saveToLibraryAsync(uri) {
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = uri;
    a.download = 'fara-activity.jpg';
    a.click();
    return;
  }
  await Share.share({ url: uri }, { dialogTitle: 'Save to Camera Roll' });
}

async function createAssetAsync(uri) {
  await saveToLibraryAsync(uri);
  return { uri };
}

module.exports = {
  PermissionStatus,
  requestPermissionsAsync,
  getPermissionsAsync,
  saveToLibraryAsync,
  createAssetAsync,
};
