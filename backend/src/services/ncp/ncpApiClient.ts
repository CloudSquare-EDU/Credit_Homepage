/**
 * NCP API 기본 클라이언트
 * API 서명 생성 및 공통 요청 처리
 */

import crypto from 'crypto';
import https from 'https';
import http from 'http';

export interface NcpApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export interface NcpCredentials {
  accessKey: string;
  secretKey: string;
}

export class NcpApiClient {
  protected accessKey: string;
  protected secretKey: string;

  constructor(credentials: NcpCredentials) {
    this.accessKey = credentials.accessKey;
    this.secretKey = credentials.secretKey;
  }

  /**
   * NCP API 서명 생성 (HMAC-SHA256)
   */
  protected makeSignature(method: string, uri: string, timestamp: string): string {
    const message = `${method} ${uri}\n${timestamp}\n${this.accessKey}`;
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(message);
    return hmac.digest('base64');
  }

  /**
   * API 요청 헤더 생성
   */
  protected getHeaders(method: string, uri: string): Record<string, string> {
    const timestamp = Date.now().toString();
    const signature = this.makeSignature(method, uri, timestamp);

    return {
      'x-ncp-apigw-timestamp': timestamp,
      'x-ncp-iam-access-key': this.accessKey,
      'x-ncp-apigw-signature-v2': signature,
      'Content-Type': 'application/json'
    };
  }

  /**
   * HTTP 요청 실행
   */
  protected async request<T>(
    baseUrl: string,
    method: string,
    uri: string,
    body?: unknown
  ): Promise<NcpApiResponse<T>> {
    return new Promise((resolve) => {
      const url = new URL(baseUrl + uri);
      const headers = this.getHeaders(method, uri);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 30000
      };

      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const statusCode = res.statusCode || 500;

            if (statusCode >= 200 && statusCode < 300) {
              const parsed = data ? JSON.parse(data) : {};
              resolve({
                success: true,
                data: parsed as T,
                statusCode
              });
            } else {
              resolve({
                success: false,
                error: data || `HTTP ${statusCode}`,
                statusCode
              });
            }
          } catch (e) {
            resolve({
              success: false,
              error: `Parse error: ${e}`,
              statusCode: res.statusCode
            });
          }
        });
      });

      req.on('error', (e) => {
        resolve({
          success: false,
          error: `Request error: ${e.message}`
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timeout'
        });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }
}
