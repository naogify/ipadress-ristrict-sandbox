#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkProjectStack } from '../lib/s3-cloudfront-waf-stack';

const app = new cdk.App();

new CdkProjectStack(app, 'S3CloudFrontWafStack', { env: { region: 'us-east-1' } });
