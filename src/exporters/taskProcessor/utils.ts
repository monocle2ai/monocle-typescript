export function isAwsLambdaEnvironment(): boolean {
    return process.env.AWS_LAMBDA_RUNTIME_API !== undefined;
}
