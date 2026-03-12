#!/bin/bash
EXPO_PUBLIC_DOMAIN=PaceUp.replit.app eas update --channel production --message "${1:-Update}"
