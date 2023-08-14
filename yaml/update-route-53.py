"""
update route 53 record 
please change to entest aws account 
"""

import os 
import boto3

# change to entest account 
os.system("set-aws-account.sh entest ap-southeast-1")

# route53 client
client = boto3.client('route53')

# update load balancer dns 
response = client.change_resource_record_sets(
    ChangeBatch={
        'Changes': [
            {
                'Action': 'UPSERT',
                'ResourceRecordSet': {
                    'Name': 'disagree.entest.io',
                    'ResourceRecords': [
                        {
                            'Value': 'a60fd4effcfc14f96a5e65e007a3d3de-304452142.ap-southeast-1.elb.amazonaws.com',
                        },
                    ],
                    'TTL': 300,
                    'Type': 'CNAME',
                },
            },
        ],
        'Comment': 'Web Server',
    },
    HostedZoneId='Z085201926Z176T5SURVO',
)

print(response)

# change back to demo account 
os.system("set-aws-account.sh haimtran ap-southeast-1")