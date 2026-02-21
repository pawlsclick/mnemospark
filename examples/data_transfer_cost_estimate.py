#!/usr/bin/env python3
"""
Estimate data transfer cost (ingress or egress) using the BCM Pricing Calculator API.

Models cost for moving data into or out of AWS. Ingress from the internet is usually
$0; regional (between AZs) and egress (out to internet) are billable.
Requires: boto3, AWS credentials with bcm-pricing-calculator permissions.

Run from the repository root (mnemospark/):

  python examples/data_transfer_cost_estimate.py --direction in --gb 100 --region us-east-1
  python examples/data_transfer_cost_estimate.py --direction out --gb 500 --region eu-north-1

See: https://docs.aws.amazon.com/cur/latest/userguide/cur-data-transfers-charges.html
"""

import argparse
import time

import boto3


# Region prefix for usage types (CUR format). BCM may use same or generic name.
REGION_CODES = {
    "us-east-1": "USE1",
    "us-east-2": "USE2",
    "us-west-1": "USW1",
    "us-west-2": "USW2",
    "eu-west-1": "EUW1",
    "eu-west-2": "EUW2",
    "eu-central-1": "EUC1",
    "eu-central-2": "EUC2",
    "eu-north-1": "EUN1",
    "ap-northeast-1": "APN1",
    "ap-northeast-2": "APN2",
    "ap-southeast-1": "APS1",
    "ap-southeast-2": "APS2",
    "ap-south-1": "AP1",
    "sa-east-1": "SAE1",
}

# Usage types (CUR): Regional = between AZs (both dirs charged); Out = to internet.
# Ingress from internet is $0 and may not have a billable usage type in the calculator.
USAGE_TYPE_EGRESS = "DataTransfer-Out-Bytes"  # to internet
USAGE_TYPE_REGIONAL = "DataTransfer-Regional-Bytes"  # between AZs, same region


def estimate_data_transfer_cost(
    data_gb: float,
    direction: str,
    region: str = "us-east-1",
    rate_type: str = "BEFORE_DISCOUNTS",
    account_id: str | None = None,
) -> dict:
    """
    Estimate monthly cost for data transfer via BCM Pricing Calculator.

    Args:
        data_gb: Data volume in GB (e.g. 100 = 100 GB/month).
        direction: 'in' (ingress/regional) or 'out' (egress to internet).
        region: AWS region.
        rate_type: BEFORE_DISCOUNTS | AFTER_DISCOUNTS | AFTER_DISCOUNTS_AND_COMMITMENTS.
        account_id: AWS account ID (optional; resolved from STS if not set).

    Returns:
        Workload estimate response with totalCost, costCurrency, status, etc.
    """
    client = boto3.client("bcm-pricing-calculator", region_name="us-east-1")
    if not account_id:
        account_id = boto3.client("sts").get_caller_identity()["Account"]

    region_code = REGION_CODES.get(region, "USE1")
    if direction == "out":
        usage_type = f"{region_code}-{USAGE_TYPE_EGRESS}"
        name_suffix = "egress"
    else:
        usage_type = f"{region_code}-{USAGE_TYPE_REGIONAL}"
        name_suffix = "ingress-regional"

    create = client.create_workload_estimate(
        name="DataTransfer-cost-est",
        rateType=rate_type,
    )
    workload_id = create["id"]

    try:
        client.batch_create_workload_estimate_usage(
            workloadEstimateId=workload_id,
            usage=[
                {
                    "serviceCode": "AmazonEC2",
                    "usageType": usage_type,
                    "operation": "",
                    "key": "dtxfer01",
                    "usageAccountId": str(account_id),
                    "amount": float(data_gb),
                    "group": "mnemospark",
                }
            ],
        )
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
        description="Estimate data transfer cost (ingress/egress) via BCM Pricing Calculator"
    )
    parser.add_argument(
        "--direction",
        choices=("in", "out"),
        default="in",
        help="'in' = ingress/regional (AZ-to-AZ); 'out' = egress to internet (default: in)",
    )
    parser.add_argument(
        "--gb",
        type=float,
        default=100.0,
        help="Data volume in GB per month (default: 100)",
    )
    parser.add_argument(
        "--region",
        default="us-east-1",
        help="AWS region (default: us-east-1)",
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

    result = estimate_data_transfer_cost(
        data_gb=args.gb,
        direction=args.direction,
        region=args.region,
        rate_type=args.rate_type,
    )
    dir_label = "egress (out to internet)" if args.direction == "out" else "ingress/regional (AZ-to-AZ)"
    print(
        f"Estimated cost: {result['totalCost']:.2f} {result['costCurrency']} "
        f"({args.gb} GB {dir_label} in {args.region}, rate: {args.rate_type})"
    )
    if args.direction == "in":
        print("Note: Data transfer from the internet into AWS is typically $0; this model uses regional (between-AZ) transfer.")


if __name__ == "__main__":
    main()
