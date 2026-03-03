'use strict';
const { Share, Platform } = require('react-native');

async function isAvailableAsync() {
  return true;
}

async function shareAsync(url, options = {}) {
  const message = options.dialogTitle || 'Share your activity';
  if (Platform.OS === 'web') {
    if (navigator && navigator.share) {
      await navigator.share({ url, title: message });
    } else {
      window.open(url, '_blank');
    }
    return;
  }
  await Share.share({ url, message }, { dialogTitle: message });
}

module.exports = { isAvailableAsync, shareAsync };
