## Overview

Step to run the test cases.

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

# Environment Variables Setup and Running the tests

## Environment Variables Setup

You need to export the following environment variables for the project to function properly. Ensure to replace the placeholder values with your actual keys and sensitive information.

### For Windows:

To set the environment variables on Windows, use the following commands in Command Prompt or PowerShell:

```cmd
set AZURE_OPENAI_API_DEPLOYMENT="your-azure-deployment-name"
set AZURE_OPENAI_API_KEY="your-azure-api-key"
set AZURE_OPENAI_API_VERSION="your-azure-api-version"
set AZURE_OPENAI_ENDPOINT="your-azure-endpoint-url"
set OPENAI_API_KEY="your-openai-api-key"
set MONOCLE_BLOB_CONNECTION_STRING="your-blob-connection-string"
set MONOCLE_BLOB_CONTAINER_NAME="your-blob-container-name"
set OPENSEARCH_ENDPOINT_URL_BOTO="your-opensearch-endpoint-boto"
set OPENSEARCH_ENDPOINT_URL="your-opensearch-endpoint"
set AWS_ACCESS_KEY_ID="your-aws-access-key-id"
set AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key"
set AWS_ACCESS_KEY_ID_EXPORTER="your-aws-access-key-id-exporter"
set AWS_SECRET_ACCESS_KEY_EXPORTER="your-aws-secret-access-key-exporter"
set MISTRAL_API_KEY="your-mistral-api-key"
set OPENSEARCH_ENDPOINT="your-open-search-endpoint"
set OPENSEARCH_USERNAME="your-open-search-username"
set OPENSEARCH_PASSWORD="your-open-search-password"

```

### For Mac and Linux:

To export the environment variables, run these commands in your terminal, or add them to your shell configuration file (e.g., `~/.bashrc`, `~/.zshrc`):

```bash
export AZURE_OPENAI_API_DEPLOYMENT="your-azure-deployment-name"
export AZURE_OPENAI_API_KEY="your-azure-api-key"
export AZURE_OPENAI_API_VERSION="your-azure-api-version"
export AZURE_OPENAI_ENDPOINT="your-azure-endpoint-url"
export OPENAI_API_KEY="your-openai-api-key"
export MONOCLE_BLOB_CONNECTION_STRING="your-blob-connection-string"
export MONOCLE_BLOB_CONTAINER_NAME="your-blob-container-name"
export OPENSEARCH_ENDPOINT_URL_BOTO="your-opensearch-endpoint-boto"
export OPENSEARCH_ENDPOINT_URL="your-opensearch-endpoint"
export AWS_ACCESS_KEY_ID="your-aws-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key"
export AWS_ACCESS_KEY_ID_EXPORTER="your-aws-access-key-id-exporter"
export AWS_SECRET_ACCESS_KEY_EXPORTER="your-aws-secret-access-key-exporter"
export MISTRAL_API_KEY="your-mistral-api-key"
export OPENSEARCH_ENDPOINT="your-open-search-endpoint"
export OPENSEARCH_USERNAME="your-open-search-username"
export OPENSEARCH_PASSWORD="your-open-search-password"
```

## Testing the Project

Once the environment variables are set, you can run the run the tests using the following commands.

### For Windows:

1. To run the test, run the following command in Command Prompt or PowerShell:

   ```cmd
   npm test
   ```
