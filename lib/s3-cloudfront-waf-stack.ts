import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront_origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from 'aws-cdk-lib/aws-iam';

export class CdkProjectStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // wafのIPアドレスのホワイトリスト
    const ipWhiteList = ['157.14.104.216/32'];

    // IP setsの定義
    const iPSet = new wafv2.CfnIPSet(this, "SampleWhiteListIPSet", {
      name: "sample-white-list-ipset",
      addresses: ipWhiteList,
      ipAddressVersion: "IPV4",
      scope: "CLOUDFRONT",
    });

    // cloudfrontのアクセスをIPアドレス制限するwafの定義
    const webACL = new wafv2.CfnWebACL(this, "SampleWebACL", {
      name: "sample-web-acl",
      defaultAction: {
        block: {}, // デフォルトでブロックする
      },
      scope: "CLOUDFRONT",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "sample-webacl-rule-metric", 
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          priority: 0,
          name: "sample-webacl-rule",
          action: { allow: {} }, // IPアドレスがマッチした場合は許可する
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "sample-webacl-rule-metric",
          },
          statement: {
            ipSetReferenceStatement: {
              arn: iPSet.attrArn,
            },
          },
        },
      ],
    });

    // S3バケット作成
    const bucket = new s3.Bucket(this, 'IPAdressRestrictTestBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // テスト用にS3バケットを削除可能に設定
    });

    // OAC
    const cfnOriginAccessControl = new cloudfront.CfnOriginAccessControl(this, 'OriginAccessControl', {
      originAccessControlConfig: {
          name: 'OriginAccessControlForContentsBucket',
          originAccessControlOriginType: 's3',
          signingBehavior: 'always',
          signingProtocol: 'sigv4',
          description: 'Access Control',
      },
    }); 

    // cloudfrontの定義
    const distribution = new cloudfront.Distribution(
      this,
      "SampleDistribution",
      {
        defaultRootObject: 'index.html',
        webAclId: webACL.attrArn, // webAclの設定を反映
        defaultBehavior: {
          origin: new cloudfront_origins.S3Origin(bucket),
          cachePolicy: new cloudfront.CachePolicy(
            this,
            "SampleDistributionCachePolicy",
            {
              headerBehavior:
                cloudfront.CacheHeaderBehavior.allowList("Authorization"),
            }
          ),
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      }
    );

    // bucketにCloudFrontからのアクセスを許可する
    const bucketPolicyStatement = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      effect: iam.Effect.ALLOW,
      principals: [
          new iam.ServicePrincipal('cloudfront.amazonaws.com')
      ],
      resources: [`${bucket.bucketArn}/*`]
    });
    bucketPolicyStatement.addCondition('StringEquals', {
      'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${distribution.distributionId}`
    });
    bucket.addToResourcePolicy(bucketPolicyStatement);


    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', cfnOriginAccessControl.getAtt('Id'));
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.DomainName', bucket.bucketRegionalDomainName);
    cfnDistribution.addOverride('Properties.DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', "");
    cfnDistribution.addPropertyDeletionOverride('DistributionConfig.Origins.0.CustomOriginConfig');


    // S3にHTMLファイルをデプロイ
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('./website')],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],  // デプロイ後にCloudFrontキャッシュをクリア
    });
  }
}