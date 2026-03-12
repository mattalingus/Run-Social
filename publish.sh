#!/bin/bash
CI=1 EAS_SKIP_AUTO_FINGERPRINT=1 EXPO_PUBLIC_DOMAIN=PaceUp.replit.app eas update --channel production --message "${1:-Update}"
