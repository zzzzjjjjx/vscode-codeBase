/**
 * 压缩向量 Upsert 接口调试测试
 * 专门测试新的压缩向量格式在 /api/v1/codebase/upsert 接口中的表现
 */

const axios = require('axios');

class CompressedVectorUpsertDebugger {
    constructor() {
        this.baseURL = 'http://42.193.14.136:8087';
        this.testResults = [];
    }

    async makeRequest(endpoint, data, description) {
        const startTime = Date.now();
        
        try {
            console.log(`\n🔍 ${description}`);
            console.log(`📡 请求地址: ${this.baseURL}${endpoint}`);
            console.log(`📦 请求数据:`, JSON.stringify(data, null, 2));
            
            const response = await axios.post(`${this.baseURL}${endpoint}`, data, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000,
                validateStatus: function (status) {
                    return status < 600; // 允许所有小于600的状态码
                }
            });
            
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            console.log(`📋 响应状态: ${response.status}`);
            console.log(`⏱️  响应时间: ${responseTime}ms`);
            console.log(`📄 响应数据:`, JSON.stringify(response.data, null, 2));
            
            return {
                success: response.status >= 200 && response.status < 300,
                statusCode: response.status,
                data: response.data,
                responseTime,
                headers: response.headers
            };
            
        } catch (error) {
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            console.log(`❌ 请求失败:`, error.message);
            if (error.response) {
                console.log(`📋 错误状态: ${error.response.status}`);
                console.log(`📄 错误响应:`, JSON.stringify(error.response.data, null, 2));
            }
            console.log(`⏱️  响应时间: ${responseTime}ms`);
            
            return {
                success: false,
                statusCode: error.response?.status || 0,
                data: error.response?.data || null,
                error: error.message,
                responseTime
            };
        }
    }

    // 测试1: 标准非压缩向量
    async testStandardVector() {
        const requestData = {
            requestId: `test-standard-${Date.now()}`,
            database: 'codebase_db',
            collection: 'code_vectors1',
            documents: [{
                snippet_id: `test-standard-${Date.now()}`,
                user_id: 'test-user',
                device_id: 'test-device',
                workspace_path: '/test/workspace',
                file_path: 'test/standard.js',
                start_line: 1,
                end_line: 10,
                code: 'function test() { return "standard"; }',
                vector: Array.from({length: 768}, () => Math.random()),
                compressedVector: null,
                isCompressed: false,
                vector_model: 'CoCoSoDa-v1.0'
            }],
            buildIndex: true
        };

        const result = await this.makeRequest('/api/v1/codebase/upsert', requestData, '测试标准非压缩向量');
        this.testResults.push({
            name: 'standard_vector',
            ...result
        });
        return result;
    }

    // 测试2: 压缩向量（模拟真实数据）
    async testCompressedVector() {
        // 模拟真实的压缩向量数据（从您的日志中获取）
        const compressedData = "H4sIAFQjWWgC/wXBDXAU1QEAYGgRhp+AwRJAAsGQ5vJzd7nb3ff2vV0MTA0/AXHSHKBIKhURDbRCHajGpIB4FvmrE5CAYwixEXu53O7t7r237709CUMHFQuVkfgTQhJMQyk0RCR0Guw0tN/XLvryQ2ghayyeCv4O67SnRD9aDit1P91WomApCdQf+CN4GM4obFe2JHuUsHZMWdi6DL7sbRU91ij1LXDR7seQ7KNH8S7QxeN8XLqBdqT2e304y92EVydbYJ0YME7iiLtYyxF6gQAHtGZjeayDNzvTY/3SsNoovuIj9kswB9WyjWGC20H8eBfp4O10LhvAedwnVie7wDU+xzC4Q24rvUV/Qhuda9DvnJRqgln4y0RpLE563ah00WwQ/5I7QdipjtGiOY1JebNcybAjBfvfvadFwUHyqOKHR4VCX/zghLohvDlcAZ/Qt4ob9pv+V8A514bxQKubDYfgIK+XDrp19Lhe6ta41eBRcsn7HD+Z2oP3sUXkeXUbvgduBMeLI/xOQlbPGLO5iX5EKvlo7yx6SHwcnyF8YCRRpr5HH0PFdJu/Cn3kzcK1rX9wb4Vmw2w4xfqLWMfarS7yGN+Bc0SMzHRfUKakw4ludMP7lt8CABwhpSDkvZ7/M3OCXCkySAE8j+taD3k/oKfYK+4usgD/E/WCZWiKNxd+6Pq0Jnyi8W/BKGap6ZqJ6gOH83PFZZQFv2D73WLxIP6HtIZgTIzojI3iafMmAuSYJtyRkj5pPo+wMy3HRRV1tZ1MFOhoJ5sXu++WS3vRJDYLJ4yJVvUHv1G2fDhJzqWlvjPoYZHpHWNnS14zFvF5bCZdoV0JncIRrVnOY81edvyPJVfiz4AcPFatsqbRq6wP5ZBzedfVw05+OoIG6KFUkCxL72MJNKKdcpu0t0BbOAomigPuAnpU+7N3x/ifGidvuBqajMY6VWRv8pS2WQyBAuWiHVC+124Lv6Jp9eaY1l/zCen1nurlUyGXug+AmlQljYiPA6vME3zQ2c0jeLTkkvvmZNHC5/z0/bYFfLrco+11l8NHmGUI9Twch9yWQecq3Z4eyC/Vfqwv5RV0idKtnbNl+DtSqH2jPmSMCl9D1fZlfoAPF1aATHwN3LQ2wAxlN5zHd3vzkZdar2a2ZGltgT7npDUQHEpWc0P8V3kf+0reNnLJSnMJahArpZcczH7V8pxhyo0wqJ5EuWq1/DW7IJ+DPnOlfyteiG+axVJMlKPDhVHGSg7CU956pdvqUlR3ldhpT9dWxy9bk9D9gvvyECIom3eGMpK9znxA5UvY9e8QDWKRKCNT9O+tDd4T/pfxKn1aqskYsSYnl2tvp9bwLt/oXJv79VHh2dhHOpUVuNwrCUc8yZjqreWvpiNylBUlno7tFwZZq3YXjFfuiTrlllrIdTwo1oiP0DhlpvFdaBN618oJLFZPAz9tcjP4v2NXxEywkn8inkW7eUV62HlPcYCPb/eut4Xo4sTv6YNFW/hpO4X+yht4PX7YsNmEdBPocCxv0HrRPkLvFLeG1ipZ2hjQ417QSTyTleuNyWzQETCUvewiPY+WWlAbo5SRPaGfp3NifSGIx+JP6eN02J6qLtWKaa39HI4o51GR1IxHubuC87wV0EJXJUW8qh4KVnGWDulB50rwF9JcPhlXwst0lfQtywwgbzEdKETwrhLyPHlOkYTe8drIfLMjdEEO6hW0k5eQ70xhFQbKyN1EhLYot9Xfss9c079ZXeDlpQzyE7AMvhPm7lRvItyBavg6cF1d4vWjKFpPdwpV/Ad9wyRXc8br0fAzqFytn8XIL7Xa0DFpe3Ou0Onz9hvAxabIQaeTE6BuXErBontyp+0XyUSPavJadlay6U0oRA+rlu8moNkttztLnE32ENnjnjUsPA2sE1v1J0mC1lgxt1Hyu6VwHX0AZ6BeVKbJ8HWUgT5Hr2mZ3lL0dTxv7uNeh7WW/R8+ACcNAAYAAA==";
        
        const requestData = {
            requestId: `test-compressed-${Date.now()}`,
            database: 'codebase_db',
            collection: 'code_vectors1',
            documents: [{
                snippet_id: `test-compressed-${Date.now()}`,
                user_id: 'test-user',
                device_id: 'test-device',
                workspace_path: '/test/workspace',
                file_path: 'test/compressed.js',
                start_line: 1,
                end_line: 15,
                code: 'function test() { return "compressed"; }',
                vector: null,
                compressedVector: compressedData,
                isCompressed: true,
                vector_model: 'code-embedding-v2.1'
            }],
            buildIndex: true
        };

        const result = await this.makeRequest('/api/v1/codebase/upsert', requestData, '测试压缩向量');
        this.testResults.push({
            name: 'compressed_vector',
            ...result
        });
        return result;
    }

    // 测试3: 缺少压缩字段的情况
    async testMissingCompressedFields() {
        const requestData = {
            requestId: `test-missing-${Date.now()}`,
            database: 'codebase_db',
            collection: 'code_vectors1',
            documents: [{
                snippet_id: `test-missing-${Date.now()}`,
                user_id: 'test-user',
                device_id: 'test-device',
                workspace_path: '/test/workspace',
                file_path: 'test/missing.js',
                start_line: 1,
                end_line: 10,
                code: 'function test() { return "missing"; }',
                // 故意缺少 vector, compressedVector, isCompressed 字段
                vector_model: 'CoCoSoDa-v1.0'
            }],
            buildIndex: true
        };

        const result = await this.makeRequest('/api/v1/codebase/upsert', requestData, '测试缺少压缩字段');
        this.testResults.push({
            name: 'missing_fields',
            ...result
        });
        return result;
    }

    // 测试4: 错误的压缩数据格式
    async testInvalidCompressedData() {
        const requestData = {
            requestId: `test-invalid-${Date.now()}`,
            database: 'codebase_db',
            collection: 'code_vectors1',
            documents: [{
                snippet_id: `test-invalid-${Date.now()}`,
                user_id: 'test-user',
                device_id: 'test-device',
                workspace_path: '/test/workspace',
                file_path: 'test/invalid.js',
                start_line: 1,
                end_line: 10,
                code: 'function test() { return "invalid"; }',
                vector: null,
                compressedVector: "invalid_compressed_data",
                isCompressed: true,
                vector_model: 'CoCoSoDa-v1.0'
            }],
            buildIndex: true
        };

        const result = await this.makeRequest('/api/v1/codebase/upsert', requestData, '测试无效压缩数据');
        this.testResults.push({
            name: 'invalid_compressed',
            ...result
        });
        return result;
    }

    // 测试5: 批量混合格式
    async testMixedBatch() {
        const compressedData = "H4sIAFQjWWgC/wXBDXAU1QEAYGgRhp+AwRJAAsGQ5vJzd7lb3ff2vV0MTA0/AXHSHKBIKhURDbRCHajGpIB4FvmrE5CAYwixEXu53O7t7r237709CUMHFQuVkfgTQhJMQyk0RCR0Guw0tN/XLvryQ2ghayyeCv4O67SnRD9aDit1P91WomApCdQf+CN4GM4obFe2JHuUsHZMWdi6DL7sbRU91ij1LXDR7seQ7KNH8S7QxeN8XLqBdqT2e304y92EVydbYJ0YME7iiLtYyxF6gQAHtGZjeayDNzvTY/3SsNoovuIj9kswB9WyjWGC20H8eBfp4O10LhvAedwnVie7wDU+xzC4Q24rvUV/Qhuda9DvnJRqgln4y0RpLE563ah00WwQ/5I7QdipjtGiOY1JebNcybAjBfvfvadFwUHyqOKHR4VCX/zghLohvDlcAZ/Qt4ob9pv+V8A514bxQKubDYfgIK+XDrp19Lhe6ta41eBRcsn7HD+Z2oP3sUXkeXUbvgduBMeLI/xOQlbPGLO5iX5EKvlo7yx6SHwcnyF8YCRRpr5HH0PFdJu/Cn3kzcK1rX9wb4Vmw2w4xfqLWMfarS7yGN+Bc0SMzHRfUKakw4ludMP7lt8CABwhpSDkvZ7/M3OCXCkySAE8j+taD3k/oKfYK+4usgD/E/WCZWiKNxd+6Pq0Jnyi8W/BKGap6ZqJ6gOH83PFZZQFv2D73WLxIP6HtIZgTIzojI3iafMmAuSYJtyRkj5pPo+wMy3HRRV1tZ1MFOhoJ5sXu++WS3vRJDYLJ4yJVvUHv1G2fDhJzqWlvjPoYZHpHWNnS14zFvF5bCZdoV0JncIRrVnOY81edvyPJVfiz4AcPFatsqbRq6wP5ZBzedfVw05+OoIG6KFUkCxL72MJNKKdcpu0t0BbOAomigPuAnpU+7N3x/ifGidvuBqajMY6VWRv8pS2WQyBAuWiHVC+124Lv6Jp9eaY1l/zCen1nurlUyGXug+AmlQljYiPA6vME3zQ2c0jeLTkkvvmZNHC5/z0/bYFfLrco+11l8NHmGUI9Twch9yWQecq3Z4eyC/Vfqwv5RV0idKtnbNl+DtSqH2jPmSMCl9D1fZlfoAPF1aATHwN3LQ2wAxlN5zHd3vzkZdar2a2ZGltgT7npDUQHEpWc0P8V3kf+0reNnLJSnMJahArpZcczH7V8pxhyo0wqJ5EuWq1/DW7IJ+DPnOlfyteiG+axVJMlKPDhVHGSg7CU956pdvqUlR3ldhpT9dWxy9bk9D9gvvyECIom3eGMpK9znxA5UvY9e8QDWKRKCNT9O+tDd4T/pfxKn1aqskYsSYnl2tvp9bwLt/oXJv79VHh2dhHOpUVuNwrCUc8yZjqreWvpiNylBUlno7tFwZZq3YXjFfuiTrlllrIdTwo1oiP0DhlpvFdaBN618oJLFZPAz9tcjP4v2NXxEywkn8inkW7eUV62HlPcYCPb/eut4Xo4sTv6YNFW/hpO4X+yht4PX7YsNmEdBPocCxv0HrRPkLvFLeG1ipZ2hjQ417QSTyTleuNyWzQETCUvewiPY+WWlAbo5SRPaGfp3NifSGIx+JP6eN02J6qLtWKaa39HI4o51GR1IxHubuC87wV0EJXJUW8qh4KVnGWDulB50rwF9JcPhlXwst0lfQtywwgbzEdKETwrhLyPHlOkYTe8drIfLMjdEEO6hW0k5eQ70xhFQbKyN1EhLYot9Xfss9c079ZXeDlpQzyE7AMvhPm7lRvItyBavg6cF1d4vWjKFpPdwpV/Ad9wyRXc8br0fAzqFytn8XIL7Xa0DFpe3Ou0Onz9hvAxabIQaeTE6BuXErBontyp+0XyUSPavJadlay6U0oRA+rlu8moNkttztLnE32ENnjnjUsPA2sE1v1J0mC1lgxt1Hyu6VwHX0AZ6BeVKbJ8HWUgT5Hr2mZ3lL0dTxv7uNeh7WW/R8+ACcNAAYAAA==";
        
        const requestData = {
            requestId: `test-mixed-${Date.now()}`,
            database: 'codebase_db',
            collection: 'code_vectors1',
            documents: [
                {
                    snippet_id: `test-mixed-std-${Date.now()}`,
                    user_id: 'test-user',
                    device_id: 'test-device',
                    workspace_path: '/test/workspace',
                    file_path: 'test/mixed1.js',
                    start_line: 1,
                    end_line: 10,
                    code: 'function test1() { return "standard"; }',
                    vector: Array.from({length: 768}, () => Math.random()),
                    compressedVector: null,
                    isCompressed: false,
                    vector_model: 'CoCoSoDa-v1.0'
                },
                {
                    snippet_id: `test-mixed-comp-${Date.now()}`,
                    user_id: 'test-user',
                    device_id: 'test-device',
                    workspace_path: '/test/workspace',
                    file_path: 'test/mixed2.js',
                    start_line: 11,
                    end_line: 25,
                    code: 'function test2() { return "compressed"; }',
                    vector: null,
                    compressedVector: compressedData,
                    isCompressed: true,
                    vector_model: 'code-embedding-v2.1'
                }
            ],
            buildIndex: true
        };

        const result = await this.makeRequest('/api/v1/codebase/upsert', requestData, '测试混合批量数据');
        this.testResults.push({
            name: 'mixed_batch',
            ...result
        });
        return result;
    }

    // 运行所有测试
    async runAllTests() {
        console.log('🧪 开始压缩向量 Upsert 接口调试测试...\n');
        
        try {
            console.log('=' .repeat(60));
            await this.testStandardVector();
            
            console.log('=' .repeat(60));
            await this.testCompressedVector();
            
            console.log('=' .repeat(60));
            await this.testMissingCompressedFields();
            
            console.log('=' .repeat(60));
            await this.testInvalidCompressedData();
            
            console.log('=' .repeat(60));
            await this.testMixedBatch();
            
            console.log('=' .repeat(60));
            this.printSummary();
            
        } catch (error) {
            console.error('❌ 测试过程中发生错误:', error.message);
        }
    }

    // 打印测试总结
    printSummary() {
        console.log('\n📊 测试总结报告');
        console.log('=' .repeat(60));
        
        const successful = this.testResults.filter(r => r.success);
        const failed = this.testResults.filter(r => !r.success);
        
        console.log(`✅ 成功测试: ${successful.length}`);
        console.log(`❌ 失败测试: ${failed.length}`);
        console.log(`📈 成功率: ${((successful.length / this.testResults.length) * 100).toFixed(1)}%`);
        
        console.log('\n📋 详细结果:');
        this.testResults.forEach(result => {
            const status = result.success ? '✅' : '❌';
            console.log(`   ${status} ${result.name}: ${result.statusCode} (${result.responseTime}ms)`);
            
            if (!result.success && result.data) {
                console.log(`      错误: ${result.data.error || result.error || '未知错误'}`);
            }
        });
        
        if (failed.length > 0) {
            console.log('\n🔍 问题分析:');
            const statusCodes = [...new Set(failed.map(r => r.statusCode))];
            statusCodes.forEach(code => {
                const count = failed.filter(r => r.statusCode === code).length;
                console.log(`   HTTP ${code}: ${count} 次失败`);
            });
        }
    }
}

// 运行测试
if (require.main === module) {
    const tester = new CompressedVectorUpsertDebugger();
    tester.runAllTests().catch(console.error);
}

module.exports = CompressedVectorUpsertDebugger; 