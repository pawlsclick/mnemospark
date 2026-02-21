#!/usr/bin/env python3
"""
Minimal example: estimate S3 Standard storage cost using the BCM Pricing Calculator API.

Estimates monthly cost for a given amount of S3 Standard storage. Use --region to pass
any AWS region (e.g. us-east-1, eu-north-1, ap-southeast-1); the API may return
pricing for a default region if it does not support location in the request.
Requires: boto3, AWS credentials with bcm-pricing-calculator permissions.

Run from the repository root (mnemospark/), not from examples/ or s3-cost-estimate-api/:

  python examples/s3_storage_cost_estimate.py --gb 100 --region eu-north-1
  python examples/s3_storage_cost_estimate.py --gb 500 --region us-east-1

Verify pricing in the AWS console:
  • Billing → Pricing Calculator (in-console estimates)
  • Billing → Bills → current month → Amazon S3 line items
  • https://aws.amazon.com/s3/pricing/ (list prices by region)
"""

import argparse
import time

import boto3


# Usage type for S3 Standard storage (matches console export; region via location).
S3_STANDARD_STORAGE_USAGE_TYPE = "TimedStorage-ByteHrs"


def estimate_s3_storage_cost(
    storage_gb_month: float,
    region: str = "us-east-1",
    rate_type: str = "BEFORE_DISCOUNTS",
    account_id: str | None = None,
) -> dict:
    """
    Get estimated monthly cost for S3 Standard storage via BCM Pricing Calculator.

    Args:
        storage_gb_month: Storage in GB-months (e.g. 100 = 100 GB for one month).
        region: AWS region (used for usage type; API is us-east-1 only).
        rate_type: BEFORE_DISCOUNTS | AFTER_DISCOUNTS | AFTER_DISCOUNTS_AND_COMMITMENTS.
        account_id: AWS account ID for the estimate (required by API).

    Returns:
        Workload estimate response with totalCost, costCurrency, status, etc.
    """
    client = boto3.client("bcm-pricing-calculator", region_name="us-east-1")

    # Resolve account ID if not provided (e.g. from STS GetCallerIdentity).
    if not account_id:
        account_id = boto3.client("sts").get_caller_identity()["Account"]

    # 1) Create workload estimate (name: only [a-zA-Z0-9-])
    create = client.create_workload_estimate(
        name="S3-storage-cost-estimate",
        rateType=rate_type,
    )
    workload_id = create["id"]

    try:
        # 2) Add S3 Standard storage usage (align with console export: usageType + location)
        client.batch_create_workload_estimate_usage(
            workloadEstimateId=workload_id,
            usage=[
                {
                    "serviceCode": "AmazonS3",
                    "usageType": S3_STANDARD_STORAGE_USAGE_TYPE,
                    "operation": "",
                    "key": "s3storage",
                    "usageAccountId": str(account_id),
                    "amount": float(storage_gb_month),
                    "group": "mnemospark",
                }
            ],
        )

        # 3) Poll until estimate is ready
        for _ in range(30):
            est = client.get_workload_estimate(identifier=workload_id)
            if est["status"] == "VALID":
                return est
            if est["status"] == "INVALID":
                raise RuntimeError(
                    f"Estimate invalid: {est.get('failureMessage', 'unknown')}"
                )
            time.sleep(1)

        raise RuntimeError("Estimate did not become VALID in time")
    finally:
        client.delete_workload_estimate(identifier=workload_id)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Estimate S3 Standard storage cost via BCM Pricing Calculator"
    )
    parser.add_argument(
        "--gb",
        type=float,
        default=100.0,
        help="Storage in GB-months (default: 100)",
    )
    parser.add_argument(
        "--region",
        default="us-east-1",
        help="AWS region for usage type (default: us-east-1)",
    )
    parser.add_argument(
        "--rate-type",
        choices=[
            "BEFORE_DISCOUNTS",
            "AFTER_DISCOUNTS",
            "AFTER_DISCOUNTS_AND_COMMITMENTS",
        ],
        default="BEFORE_DISCOUNTS",
        help="Pricing rate type (default: BEFORE_DISCOUNTS)",
    )
    args = parser.parse_args()

    result = estimate_s3_storage_cost(
        storage_gb_month=args.gb,
        region=args.region,
        rate_type=args.rate_type,
    )
    print(
        f"Estimated cost: {result['totalCost']:.2f} {result['costCurrency']} "
        f"({args.gb} GB-month S3 Standard in {args.region}, rate: {args.rate_type})"
    )


if __name__ == "__main__":
    main()
