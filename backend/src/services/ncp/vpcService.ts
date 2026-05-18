/**
 * NCP VPC API 서비스
 * VPC, Subnet, NAT Gateway 등 네트워크 리소스 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const VPC_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface VpcInstance {
  vpcNo: string;
  vpcName: string;
  ipv4CidrBlock: string;
  vpcStatus: {
    code: string;
    codeName: string;
  };
  regionCode: string;
  createDate: string;
}

export interface SubnetInstance {
  subnetNo: string;
  subnetName: string;
  subnet?: string; // CIDR block (예: 10.0.1.0/24)
  vpc: { vpcNo: string };
  zone: { zoneCode: string };
  networkAclNo: string;
  subnetType: { code: string; codeName: string };
  usageType: { code: string; codeName: string };
  subnetStatus: { code: string; codeName: string };
  createDate: string;
}

export interface NatGatewayInstance {
  natGatewayInstanceNo: string;
  natGatewayName: string;
  publicIp: string;
  natGatewayInstanceStatus: { code: string; codeName: string };
  vpcNo: string;
  zoneCode: string;
  createDate: string;
}

export interface VpcListResponse {
  getVpcListResponse: {
    totalRows: number;
    vpcList: VpcInstance[];
  };
}

export interface SubnetListResponse {
  getSubnetListResponse: {
    totalRows: number;
    subnetList: SubnetInstance[];
  };
}

export interface NatGatewayListResponse {
  getNatGatewayInstanceListResponse: {
    totalRows: number;
    natGatewayInstanceList: NatGatewayInstance[];
  };
}

export interface VpcEndpoint {
  vpcEndpointInstanceNo: string;
  vpcEndpointName: string;
  vpcNo: string;
  vpcEndpointStatus: { code: string; codeName: string };
  serviceName: string;
  createDate: string;
}

export class NcpVpcService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * VPC 목록 조회
   */
  async getVpcList(): Promise<{ success: boolean; vpcs: VpcInstance[]; error?: string }> {
    const uri = '/vpc/v2/getVpcList?responseFormatType=json';
    const response = await this.request<VpcListResponse>(VPC_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, vpcs: [], error: response.error };
    }

    return {
      success: true,
      vpcs: response.data.getVpcListResponse?.vpcList || []
    };
  }

  /**
   * Subnet 목록 조회
   */
  async getSubnetList(vpcNo?: string): Promise<{ success: boolean; subnets: SubnetInstance[]; error?: string }> {
    let uri = '/vpc/v2/getSubnetList?responseFormatType=json';
    if (vpcNo) {
      uri += `&vpcNo=${vpcNo}`;
    }

    const response = await this.request<SubnetListResponse>(VPC_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, subnets: [], error: response.error };
    }

    return {
      success: true,
      subnets: response.data.getSubnetListResponse?.subnetList || []
    };
  }

  /**
   * NAT Gateway 목록 조회
   */
  async getNatGatewayList(): Promise<{ success: boolean; natGateways: NatGatewayInstance[]; error?: string }> {
    const uri = '/vpc/v2/getNatGatewayInstanceList?responseFormatType=json';
    const response = await this.request<NatGatewayListResponse>(VPC_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, natGateways: [], error: response.error };
    }

    return {
      success: true,
      natGateways: response.data.getNatGatewayInstanceListResponse?.natGatewayInstanceList || []
    };
  }

  /**
   * Subnet 삭제
   */
  async deleteSubnet(subnetNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vpc/v2/deleteSubnet?subnetNo=${subnetNo}&responseFormatType=json`;
    return this.request(VPC_API_URL, 'GET', uri);
  }

  /**
   * NAT Gateway 삭제
   */
  async deleteNatGateway(natGatewayInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vpc/v2/deleteNatGatewayInstance?natGatewayInstanceNo=${natGatewayInstanceNo}&responseFormatType=json`;
    return this.request(VPC_API_URL, 'GET', uri);
  }

  /**
   * VPC 삭제
   */
  async deleteVpc(vpcNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vpc/v2/deleteVpc?vpcNo=${vpcNo}&responseFormatType=json`;
    return this.request(VPC_API_URL, 'GET', uri);
  }

  /**
   * Route Table 목록 조회
   */
  async getRouteTableList(vpcNo?: string): Promise<{
    success: boolean;
    routeTables: Array<{
      routeTableNo: string;
      routeTableName: string;
      vpcNo: string;
      supportedSubnetType: { code: string; codeName: string };
      isDefault: boolean;
      routeList?: Array<{
        destinationCidrBlock: string;
        targetName: string;
        targetNo: string;
        targetType: { code: string; codeName: string };
      }>;
    }>;
    error?: string;
  }> {
    let uri = '/vpc/v2/getRouteTableList?responseFormatType=json';
    if (vpcNo) {
      uri += `&vpcNo=${vpcNo}`;
    }

    const response = await this.request<{
      getRouteTableListResponse: {
        routeTableList: Array<{
          routeTableNo: string;
          routeTableName: string;
          vpcNo: string;
          supportedSubnetType: { code: string; codeName: string };
          isDefault: boolean;
          routeList?: Array<{
            destinationCidrBlock: string;
            targetName: string;
            targetNo: string;
            targetType: { code: string; codeName: string };
          }>;
        }>;
      };
    }>(VPC_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, routeTables: [], error: response.error };
    }

    return {
      success: true,
      routeTables: response.data.getRouteTableListResponse?.routeTableList || []
    };
  }

  /**
   * Route Table 상세 조회
   */
  async getRouteTableDetail(routeTableNo: string): Promise<{
    success: boolean;
    routeTable?: {
      routeTableNo: string;
      routeTableName: string;
      vpcNo: string;
      supportedSubnetType: { code: string; codeName: string };
      isDefault: boolean;
      routeList?: Array<{
        destinationCidrBlock: string;
        targetName: string;
        targetNo: string;
        targetType: { code: string; codeName: string };
      }>;
    };
    error?: string;
  }> {
    const uri = `/vpc/v2/getRouteTableDetail?routeTableNo=${routeTableNo}&responseFormatType=json`;
    const response = await this.request<{
      getRouteTableDetailResponse: {
        routeTableList: Array<{
          routeTableNo: string;
          routeTableName: string;
          vpcNo: string;
          supportedSubnetType: { code: string; codeName: string };
          isDefault: boolean;
          routeList?: Array<{
            destinationCidrBlock: string;
            targetName: string;
            targetNo: string;
            targetType: { code: string; codeName: string };
          }>;
        }>;
      };
    }>(VPC_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, error: response.error };
    }

    return {
      success: true,
      routeTable: response.data.getRouteTableDetailResponse?.routeTableList?.[0]
    };
  }

  /**
   * Route 삭제
   */
  async removeRoute(
    vpcNo: string,
    routeTableNo: string,
    destinationCidrBlock: string,
    targetNo: string,
    targetName: string,
    targetTypeCode: string = 'NATGW'
  ): Promise<NcpApiResponse<unknown>> {
    // CIDR block의 '/' 문자를 URL encoding (0.0.0.0/0 -> 0.0.0.0%2F0)
    const encodedCidr = encodeURIComponent(destinationCidrBlock);
    const encodedName = encodeURIComponent(targetName);
    // NCP API는 routeList.N. 형식의 numbered list parameter를 요구함
    const uri = `/vpc/v2/removeRoute?vpcNo=${vpcNo}&routeTableNo=${routeTableNo}&routeList.1.destinationCidrBlock=${encodedCidr}&routeList.1.targetNo=${targetNo}&routeList.1.targetName=${encodedName}&routeList.1.targetTypeCode=${targetTypeCode}&responseFormatType=json`;
    console.log(`[REMOVE_ROUTE] VPC=${vpcNo}, RT=${routeTableNo}, dest=${destinationCidrBlock}, target=${targetNo}, name=${targetName}, type=${targetTypeCode}`);
    const result = await this.request(VPC_API_URL, 'GET', uri);
    console.log(`[REMOVE_ROUTE] Result: success=${result.success}, error=${result.error}`);
    return result;
  }

  /**
   * NAT Gateway가 사용하는 모든 가능한 route를 강제로 삭제 시도
   */
  async forceRemoveNatGatewayRoutes(natGatewayInstanceNo: string, natGatewayName: string, natGatewayVpcNo?: string): Promise<{
    success: boolean;
    deletedCount: number;
    errors: string[];
  }> {
    const routeTablesResult = await this.getRouteTableList();
    if (!routeTablesResult.success) {
      return { success: false, deletedCount: 0, errors: [routeTablesResult.error || 'Failed to get route tables'] };
    }

    console.log(`[FORCE_DELETE] Found ${routeTablesResult.routeTables.length} route tables`);

    let deletedCount = 0;
    const errors: string[] = [];

    // NAT Gateway의 VPC에 있는 모든 subnet CIDR 가져오기
    const destinationCidrs = new Set<string>([
      '0.0.0.0/0',      // 인터넷 트래픽 (가장 일반적)
      '10.0.0.0/8',     // Private network
      '172.16.0.0/12',  // Private network
      '192.168.0.0/16', // Private network
      '10.0.0.0/16',
      '10.0.0.0/24',
      '10.1.0.0/16',
      '172.16.0.0/16',
      '192.168.0.0/24'
    ]);

    // VPC의 모든 Subnet CIDR 추가
    if (natGatewayVpcNo) {
      const subnetsResult = await this.getSubnetList(natGatewayVpcNo);
      if (subnetsResult.success) {
        console.log(`[FORCE_DELETE] Found ${subnetsResult.subnets.length} subnets in VPC ${natGatewayVpcNo}`);
        for (const subnet of subnetsResult.subnets) {
          if (subnet.subnet) {
            destinationCidrs.add(subnet.subnet);
            console.log(`[FORCE_DELETE] Adding subnet CIDR: ${subnet.subnet}`);
          }
        }
      }
    }

    console.log(`[FORCE_DELETE] Total ${destinationCidrs.size} destination CIDRs to try`);

    for (const routeTable of routeTablesResult.routeTables) {
      // VPC가 지정되었으면 같은 VPC의 Route Table만 시도
      if (natGatewayVpcNo && routeTable.vpcNo !== natGatewayVpcNo) {
        continue;
      }

      console.log(`[FORCE_DELETE] Processing route table: ${routeTable.routeTableName}`);

      for (const destination of destinationCidrs) {
        const result = await this.removeRoute(
          routeTable.vpcNo,
          routeTable.routeTableNo,
          destination,
          natGatewayInstanceNo,
          natGatewayName,
          'NATGW'
        );

        if (result.success) {
          deletedCount++;
          console.log(`[FORCE_DELETE] ✓ Removed route ${destination} -> NAT from ${routeTable.routeTableName}`);
        } else {
          const errorStr = result.error || '';
          // 존재하지 않는 route는 무시 (정상)
          if (!errorStr.includes('does not exist') && !errorStr.includes('not found') && !errorStr.includes('찾을 수 없습니다')) {
            console.log(`[FORCE_DELETE] ✗ Failed ${destination}: ${result.error}`);
          }
        }

        // API 부하 방지
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[FORCE_DELETE] Total deleted routes: ${deletedCount}`);
    return { success: deletedCount > 0 || errors.length === 0, deletedCount, errors };
  }

  /**
   * NAT Gateway 를 참조하는 모든 라우트 삭제
   */
  async removeNatGatewayRoutes(natGatewayInstanceNo: string): Promise<{
    success: boolean;
    deletedCount: number;
    errors: string[];
  }> {
    const routeTablesResult = await this.getRouteTableList();
    if (!routeTablesResult.success) {
      return { success: false, deletedCount: 0, errors: [routeTablesResult.error || 'Failed to get route tables'] };
    }

    console.log(`[DEBUG] Found ${routeTablesResult.routeTables.length} route tables`);

    let deletedCount = 0;
    const errors: string[] = [];

    for (const routeTableSummary of routeTablesResult.routeTables) {
      // 각 Route Table의 상세 정보를 개별 조회
      console.log(`[DEBUG] Fetching detail for route table: ${routeTableSummary.routeTableName}`);
      const detailResult = await this.getRouteTableDetail(routeTableSummary.routeTableNo);

      if (!detailResult.success || !detailResult.routeTable) {
        console.log(`[DEBUG] Failed to get route table detail: ${detailResult.error}`);
        continue;
      }

      const routeTable = detailResult.routeTable;
      console.log(`[DEBUG] Route table: ${routeTable.routeTableName}, has routeList: ${!!routeTable.routeList}, route count: ${routeTable.routeList?.length || 0}`);

      if (!routeTable.routeList || routeTable.routeList.length === 0) continue;

      for (const route of routeTable.routeList) {
        console.log(`[DEBUG] Route: dest=${route.destinationCidrBlock}, targetNo=${route.targetNo}, targetType=${route.targetType.code}, looking for=${natGatewayInstanceNo}`);

        // NAT Gateway를 타겟으로 하는 라우트만 삭제
        if (route.targetNo === natGatewayInstanceNo && route.targetType.code === 'NATGW') {
          console.log(`[DEBUG] MATCH! Deleting route ${route.destinationCidrBlock} from ${routeTable.routeTableName}`);
          const result = await this.removeRoute(
            routeTable.vpcNo,
            routeTable.routeTableNo,
            route.destinationCidrBlock,
            route.targetNo,
            route.targetName,
            route.targetType.code
          );

          if (result.success) {
            deletedCount++;
            console.log(`[DEBUG] Route deleted successfully`);
          } else {
            console.log(`[DEBUG] Route deletion failed: ${result.error}`);
            errors.push(`Failed to remove route ${route.destinationCidrBlock} from ${routeTable.routeTableName}: ${result.error}`);
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      // Rate limiting between route table detail queries
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[DEBUG] Total deleted routes: ${deletedCount}`);

    return {
      success: errors.length === 0,
      deletedCount,
      errors
    };
  }

  /**
   * VPC Endpoint 목록 조회
   */
  async getVpcEndpoints(vpcNo?: string): Promise<{ success: boolean; endpoints: VpcEndpoint[]; error?: string }> {
    const possibleEndpoints = [
      '/vpc/v2/getVpcEndpointInstanceList',
      '/vpc/v2/getVpcEndpointList',
      '/vpcEndpoint/v2/getVpcEndpointInstanceList',
      '/vpcEndpoint/v2/getVpcEndpointList'
    ];

    for (const baseUri of possibleEndpoints) {
      let uri = `${baseUri}?responseFormatType=json`;
      if (vpcNo) {
        uri += `&vpcNo=${vpcNo}`;
      }

      console.log(`[VPC_ENDPOINT] Trying endpoint: ${uri}`);
      const response = await this.request<{
        getVpcEndpointInstanceListResponse?: {
          vpcEndpointInstanceList: VpcEndpoint[];
        };
        getVpcEndpointListResponse?: {
          vpcEndpointList: VpcEndpoint[];
        };
      }>(VPC_API_URL, 'GET', uri);

      if (response.success && response.data) {
        const endpoints =
          response.data.getVpcEndpointInstanceListResponse?.vpcEndpointInstanceList ||
          response.data.getVpcEndpointListResponse?.vpcEndpointList ||
          [];

        console.log(`[VPC_ENDPOINT] Success with endpoint: ${uri}, found ${endpoints.length} endpoints`);
        return { success: true, endpoints };
      }

      console.log(`[VPC_ENDPOINT] Failed with endpoint: ${uri}, error: ${response.error}`);
    }

    // 모든 엔드포인트 실패 시 빈 배열 반환 (VPC Endpoint가 없을 수도 있음)
    console.log(`[VPC_ENDPOINT] All endpoints failed, assuming no endpoints exist`);
    return { success: true, endpoints: [] };
  }

  /**
   * VPC Endpoint 삭제
   */
  async deleteVpcEndpoint(vpcEndpointInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const possibleEndpoints = [
      `/vpc/v2/deleteVpcEndpointInstance?vpcEndpointInstanceNo=${vpcEndpointInstanceNo}&responseFormatType=json`,
      `/vpc/v2/deleteVpcEndpoint?vpcEndpointInstanceNo=${vpcEndpointInstanceNo}&responseFormatType=json`,
      `/vpcEndpoint/v2/deleteVpcEndpointInstance?vpcEndpointInstanceNo=${vpcEndpointInstanceNo}&responseFormatType=json`,
      `/vpcEndpoint/v2/deleteVpcEndpoint?vpcEndpointNo=${vpcEndpointInstanceNo}&responseFormatType=json`
    ];

    for (const uri of possibleEndpoints) {
      console.log(`[VPC_ENDPOINT] Trying delete endpoint: ${uri}`);
      const result = await this.request(VPC_API_URL, 'GET', uri);

      if (result.success) {
        console.log(`[VPC_ENDPOINT] Delete success with endpoint: ${uri}`);
        return result;
      }

      console.log(`[VPC_ENDPOINT] Delete failed with endpoint: ${uri}, error: ${result.error}`);
    }

    return { success: false, error: 'All VPC endpoint delete endpoints failed' };
  }

  /**
   * VPC Peering 목록 조회
   */
  async getVpcPeeringList(vpcNo?: string): Promise<{
    success: boolean;
    peerings: Array<{
      vpcPeeringInstanceNo: string;
      vpcPeeringName: string;
      sourceVpcNo: string;
      targetVpcNo: string;
      vpcPeeringInstanceStatus: { code: string; codeName: string };
    }>;
    error?: string;
  }> {
    const possibleEndpoints = [
      '/vpc/v2/getVpcPeeringInstanceList',
      '/vpc/v2/getVpcPeeringList',
      '/vpcPeering/v2/getVpcPeeringInstanceList'
    ];

    for (const baseUri of possibleEndpoints) {
      let uri = `${baseUri}?responseFormatType=json`;
      if (vpcNo) {
        uri += `&vpcNo=${vpcNo}`;
      }

      console.log(`[VPC_PEERING] Trying endpoint: ${uri}`);
      const response = await this.request<{
        getVpcPeeringInstanceListResponse?: { vpcPeeringInstanceList: any[] };
        getVpcPeeringListResponse?: { vpcPeeringList: any[] };
      }>(VPC_API_URL, 'GET', uri);

      if (response.success && response.data) {
        const peerings =
          response.data.getVpcPeeringInstanceListResponse?.vpcPeeringInstanceList ||
          response.data.getVpcPeeringListResponse?.vpcPeeringList ||
          [];

        console.log(`[VPC_PEERING] Success with endpoint: ${uri}, found ${peerings.length} peerings`);
        return { success: true, peerings };
      }

      console.log(`[VPC_PEERING] Failed with endpoint: ${uri}`);
    }

    console.log(`[VPC_PEERING] All endpoints failed, returning empty list`);
    return { success: true, peerings: [] };
  }

  /**
   * VPC Peering 삭제
   */
  async deleteVpcPeering(vpcPeeringInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const possibleEndpoints = [
      `/vpc/v2/deleteVpcPeeringInstance?vpcPeeringInstanceNo=${vpcPeeringInstanceNo}&responseFormatType=json`,
      `/vpc/v2/deleteVpcPeering?vpcPeeringInstanceNo=${vpcPeeringInstanceNo}&responseFormatType=json`,
      `/vpcPeering/v2/deleteVpcPeeringInstance?vpcPeeringInstanceNo=${vpcPeeringInstanceNo}&responseFormatType=json`
    ];

    for (const uri of possibleEndpoints) {
      console.log(`[VPC_PEERING] Trying delete endpoint: ${uri}`);
      const result = await this.request(VPC_API_URL, 'GET', uri);

      if (result.success) {
        console.log(`[VPC_PEERING] Delete success with endpoint: ${uri}`);
        return result;
      }

      console.log(`[VPC_PEERING] Delete failed with endpoint: ${uri}`);
    }

    return { success: false, error: 'All VPC peering delete endpoints failed' };
  }
}
