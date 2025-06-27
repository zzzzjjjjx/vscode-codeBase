class Validator {
    constructor(config = {}) {
        this.config = config;
        this.customValidators = new Map();
        
        // 注册内置验证器
        this._registerBuiltinValidators();
    }

    // 验证对象
    validate(data, schema) {
        const errors = [];
        
        if (!schema || typeof schema !== 'object') {
            throw new Error('Schema must be an object');
        }
        
        this._validateObject(data, schema, '', errors);
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // 验证单个字段
    validateField(value, rules, fieldName = 'field') {
        const errors = [];
        
        if (!Array.isArray(rules)) {
            rules = [rules];
        }
        
        for (const rule of rules) {
            const result = this._applyRule(value, rule, fieldName);
            if (!result.isValid) {
                errors.push(result.error);
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // 注册自定义验证器
    registerValidator(name, validatorFn) {
        if (typeof validatorFn !== 'function') {
            throw new Error('Validator must be a function');
        }
        
        this.customValidators.set(name, validatorFn);
    }

    // 内部方法
    _validateObject(data, schema, path, errors) {
        for (const [key, rules] of Object.entries(schema)) {
            const fieldPath = path ? `${path}.${key}` : key;
            const value = data ? data[key] : undefined;
            
            if (Array.isArray(rules)) {
                // 多个验证规则
                for (const rule of rules) {
                    const result = this._applyRule(value, rule, fieldPath);
                    if (!result.isValid) {
                        errors.push(result.error);
                    }
                }
            } else if (typeof rules === 'object' && rules.type) {
                // 单个验证规则
                const result = this._applyRule(value, rules, fieldPath);
                if (!result.isValid) {
                    errors.push(result.error);
                }
            } else if (typeof rules === 'object') {
                // 嵌套对象验证
                if (value && typeof value === 'object') {
                    this._validateObject(value, rules, fieldPath, errors);
                }
            }
        }
    }

    _applyRule(value, rule, fieldPath) {
        if (typeof rule === 'string') {
            // 简单类型验证
            return this._validateType(value, rule, fieldPath);
        }
        
        if (typeof rule === 'function') {
            // 自定义验证函数
            return this._validateCustom(value, rule, fieldPath);
        }
        
        if (typeof rule === 'object') {
            return this._validateComplexRule(value, rule, fieldPath);
        }
        
        return { isValid: true };
    }

    _validateType(value, type, fieldPath) {
        const validator = this.customValidators.get(type) || 
                         this._getBuiltinValidator(type);
        
        if (!validator) {
            return {
                isValid: false,
                error: `Unknown validator type: ${type} for field ${fieldPath}`
            };
        }
        
        return validator(value, fieldPath);
    }

    _validateCustom(value, validatorFn, fieldPath) {
        try {
            const result = validatorFn(value, fieldPath);
            
            if (typeof result === 'boolean') {
                return {
                    isValid: result,
                    error: result ? null : `Validation failed for field ${fieldPath}`
                };
            }
            
            return result;
            
        } catch (error) {
            return {
                isValid: false,
                error: `Validation error for field ${fieldPath}: ${error.message}`
            };
        }
    }

    _validateComplexRule(value, rule, fieldPath) {
        const errors = [];
        
        // 必填验证
        if (rule.required && (value === undefined || value === null)) {
            return {
                isValid: false,
                error: `Field ${fieldPath} is required`
            };
        }
        
        // 如果字段不是必填且值为空，跳过其他验证
        if (!rule.required && (value === undefined || value === null)) {
            return { isValid: true };
        }
        
        // 类型验证
        if (rule.type) {
            const typeResult = this._validateType(value, rule.type, fieldPath);
            if (!typeResult.isValid) {
                return typeResult;
            }
        }
        
        // 长度验证
        if (rule.minLength !== undefined || rule.maxLength !== undefined) {
            const lengthResult = this._validateLength(value, rule, fieldPath);
            if (!lengthResult.isValid) {
                errors.push(lengthResult.error);
            }
        }
        
        // 范围验证
        if (rule.min !== undefined || rule.max !== undefined) {
            const rangeResult = this._validateRange(value, rule, fieldPath);
            if (!rangeResult.isValid) {
                errors.push(rangeResult.error);
            }
        }
        
        // 正则表达式验证
        if (rule.pattern) {
            const patternResult = this._validatePattern(value, rule.pattern, fieldPath);
            if (!patternResult.isValid) {
                errors.push(patternResult.error);
            }
        }
        
        // 枚举值验证
        if (rule.enum) {
            const enumResult = this._validateEnum(value, rule.enum, fieldPath);
            if (!enumResult.isValid) {
                errors.push(enumResult.error);
            }
        }
        
        // 自定义验证器
        if (rule.validator) {
            const customResult = this._validateCustom(value, rule.validator, fieldPath);
            if (!customResult.isValid) {
                errors.push(customResult.error);
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    _validateLength(value, rule, fieldPath) {
        const length = value ? value.length : 0;
        
        if (rule.minLength !== undefined && length < rule.minLength) {
            return {
                isValid: false,
                error: `Field ${fieldPath} must be at least ${rule.minLength} characters long`
            };
        }
        
        if (rule.maxLength !== undefined && length > rule.maxLength) {
            return {
                isValid: false,
                error: `Field ${fieldPath} must be no more than ${rule.maxLength} characters long`
            };
        }
        
        return { isValid: true };
    }

    _validateRange(value, rule, fieldPath) {
        const numValue = Number(value);
        
        if (isNaN(numValue)) {
            return {
                isValid: false,
                error: `Field ${fieldPath} must be a number for range validation`
            };
        }
        
        if (rule.min !== undefined && numValue < rule.min) {
            return {
                isValid: false,
                error: `Field ${fieldPath} must be at least ${rule.min}`
            };
        }
        
        if (rule.max !== undefined && numValue > rule.max) {
            return {
                isValid: false,
                error: `Field ${fieldPath} must be no more than ${rule.max}`
            };
        }
        
        return { isValid: true };
    }

    _validatePattern(value, pattern, fieldPath) {
        const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        
        if (!regex.test(String(value))) {
            return {
                isValid: false,
                error: `Field ${fieldPath} does not match required pattern`
            };
        }
        
        return { isValid: true };
    }

    _validateEnum(value, enumValues, fieldPath) {
        if (!enumValues.includes(value)) {
            return {
                isValid: false,
                error: `Field ${fieldPath} must be one of: ${enumValues.join(', ')}`
            };
        }
        
        return { isValid: true };
    }

    _registerBuiltinValidators() {
        // 基本类型验证器
        this.customValidators.set('string', (value, field) => ({
            isValid: typeof value === 'string',
            error: typeof value === 'string' ? null : `Field ${field} must be a string`
        }));
        
        this.customValidators.set('number', (value, field) => ({
            isValid: typeof value === 'number' && !isNaN(value),
            error: typeof value === 'number' && !isNaN(value) ? null : `Field ${field} must be a number`
        }));
        
        this.customValidators.set('boolean', (value, field) => ({
            isValid: typeof value === 'boolean',
            error: typeof value === 'boolean' ? null : `Field ${field} must be a boolean`
        }));
        
        this.customValidators.set('array', (value, field) => ({
            isValid: Array.isArray(value),
            error: Array.isArray(value) ? null : `Field ${field} must be an array`
        }));
        
        this.customValidators.set('object', (value, field) => ({
            isValid: value && typeof value === 'object' && !Array.isArray(value),
            error: value && typeof value === 'object' && !Array.isArray(value) ? null : `Field ${field} must be an object`
        }));
        
        // 特殊验证器
        this.customValidators.set('email', (value, field) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return {
                isValid: emailRegex.test(value),
                error: emailRegex.test(value) ? null : `Field ${field} must be a valid email address`
            };
        });
        
        this.customValidators.set('url', (value, field) => {
            try {
                new URL(value);
                return { isValid: true };
            } catch {
                return {
                    isValid: false,
                    error: `Field ${field} must be a valid URL`
                };
            }
        });
        
        this.customValidators.set('uuid', (value, field) => {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            return {
                isValid: uuidRegex.test(value),
                error: uuidRegex.test(value) ? null : `Field ${field} must be a valid UUID`
            };
        });
        
        this.customValidators.set('datestring', (value, field) => {
            const date = new Date(value);
            return {
                isValid: !isNaN(date.getTime()),
                error: !isNaN(date.getTime()) ? null : `Field ${field} must be a valid date string`
            };
        });
    }

    _getBuiltinValidator(type) {
        return this.customValidators.get(type);
    }
}

module.exports = Validator;