import { instanceToPlain } from 'class-transformer'

import {
  BadRequestException,
  Body,
  Get,
  Param,
  Patch,
  UnprocessableEntityException,
} from '@nestjs/common'

import { BanInDemo } from '~/common/decorators/demo.decorator'
import { HTTPDecorators } from '~/common/decorators/http.decorator'
import { IConfig } from '~/modules/configs/configs.interface'
import { ConfigsService } from '~/modules/configs/configs.service'
import { classToJsonSchema } from '~/utils/jsonschema.util'

import { ConfigKeyDto } from '../dtoes/config.dto'
import { OptionController } from '../option.decorator'

@OptionController()
export class BaseOptionController {
  constructor(private readonly configsService: ConfigsService) {}

  @Get('/')
  async getOption() {
    const config = await this.configsService.getConfig()
    const plainConfig = instanceToPlain(config)
    
    // 手动添加密码字段的提示信息
    if (plainConfig.mailOptions && config.mailOptions.pass) {
      plainConfig.mailOptions.pass = '***SECRET***'
    }
    
    return plainConfig
  }

  @HTTPDecorators.Bypass
  @Get('/jsonschema')
  getJsonSchema() {
    return Object.assign(classToJsonSchema(IConfig), {
      default: this.configsService.defaultConfig,
    })
  }

  @Get('/:key')
  async getOptionKey(@Param('key') key: keyof IConfig) {
    if (typeof key !== 'string' && !key) {
      throw new UnprocessableEntityException(
        `key must be IConfigKeys, got ${key}`,
      )
    }
    const value = await this.configsService.get(key)
    if (!value) {
      throw new BadRequestException('key is not exists.')
    }
    
    const plainValue = instanceToPlain(value)
    
    // 手动处理密码字段
    if (key === 'mailOptions' && (value as any).pass) {
      (plainValue as any).pass = '***SECRET***'
    }
    
    return { data: plainValue }
  }

  @Patch('/:key')
  @BanInDemo
  patch(@Param() params: ConfigKeyDto, @Body() body: Record<string, any>) {
    if (typeof body !== 'object') {
      throw new UnprocessableEntityException('body must be object')
    }
    return this.configsService.patchAndValid(params.key, body)
  }
}
