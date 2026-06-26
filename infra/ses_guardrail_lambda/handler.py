"""SES cost/abuse guardrail — auto-disable.

Invoked by SNS when the `boxd-stats-ses-volume` CloudWatch alarm trips (SES sent more
than the hourly limit). Pauses ALL SES sending account-wide immediately, to cap cost
($0.10/1k) and protect sender reputation against a runaway loop or compromised key.

Re-enable after investigating:
    aws sesv2 put-account-sending-attributes --sending-enabled
(or set Enabled=True via ses.update_account_sending_enabled)
"""
import boto3


def lambda_handler(event, context):  # noqa: ARG001 — SNS event unused; the alarm firing is the signal
    boto3.client("ses").update_account_sending_enabled(Enabled=False)
    print("SES account-level sending DISABLED by volume guardrail. Re-enable manually after investigating.")
    return {"disabled": True}
