// AWS Region 分组预设选项
export const REGION_GROUPS = [
  {
    label: "US",
    regions: [
      { label: "us-east-1 (N. Virginia)", value: "us-east-1" },
      { label: "us-east-2 (Ohio)", value: "us-east-2" },
      { label: "us-west-1 (N. California)", value: "us-west-1" },
      { label: "us-west-2 (Oregon)", value: "us-west-2" },
    ],
  },
  {
    label: "Europe",
    regions: [
      { label: "eu-west-1 (Ireland)", value: "eu-west-1" },
      { label: "eu-west-2 (London)", value: "eu-west-2" },
      { label: "eu-west-3 (Paris)", value: "eu-west-3" },
      { label: "eu-central-1 (Frankfurt)", value: "eu-central-1" },
      { label: "eu-north-1 (Stockholm)", value: "eu-north-1" },
      { label: "eu-south-1 (Milan)", value: "eu-south-1" },
    ],
  },
  {
    label: "Asia Pacific",
    regions: [
      { label: "ap-northeast-1 (Tokyo)", value: "ap-northeast-1" },
      { label: "ap-northeast-2 (Seoul)", value: "ap-northeast-2" },
      { label: "ap-northeast-3 (Osaka)", value: "ap-northeast-3" },
      { label: "ap-southeast-1 (Singapore)", value: "ap-southeast-1" },
      { label: "ap-southeast-2 (Sydney)", value: "ap-southeast-2" },
      { label: "ap-south-1 (Mumbai)", value: "ap-south-1" },
      { label: "ap-east-1 (Hong Kong)", value: "ap-east-1" },
    ],
  },
  {
    label: "Other",
    regions: [
      { label: "ca-central-1 (Canada)", value: "ca-central-1" },
      { label: "sa-east-1 (S\u00e3o Paulo)", value: "sa-east-1" },
      { label: "me-south-1 (Bahrain)", value: "me-south-1" },
      { label: "af-south-1 (Cape Town)", value: "af-south-1" },
    ],
  },
] as const

// 所有 Region 值的扁平列表（用于判断是否在预设中）
export const ALL_REGION_VALUES = REGION_GROUPS.flatMap(g => g.regions.map(r => r.value))
