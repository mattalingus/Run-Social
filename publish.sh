#!/bin/bash
# OTA updates must be run via the Replit agent using the workflow system.
# Running eas update directly in Replit's shell hits a git restriction that
# prevents the update from finalising.
#
# To publish an OTA update:
# Ask the Replit agent: "Push an OTA update with message: <your message>"
# The agent will create a temporary workflow to run:
#
# CI=1 EAS_SKIP_AUTO_FINGERPRINT=1 EXPO_PUBLIC_DOMAIN=PaceUp.replit.app \
#   eas update --channel production --message "<message>"
echo "To publish an OTA update, ask the Replit agent to run it via a workflow."
echo "Direct shell execution is blocked by Replit's git restrictions."
