#!/bin/bash

export MONOCLE_EXPORTER=file

# Check if OPENAI_API_KEY is already set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "OPENAI_API_KEY not found in environment."
    echo "Please enter your OpenAI API Key: "
    read -s OPENAI_API_KEY
    export OPENAI_API_KEY
    echo "API Key set."
else
    echo "Using existing OPENAI_API_KEY from environment."
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is required but not found. Please install Node.js and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "npm is required but not found. Please install npm and try again."
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Run exampleCustom.js
echo "Running exampleCustom.js..."
node exampleCustom.js

echo "Script execution completed."
