import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Department } from './entities/department.entity';

@Controller('departments')
@UseGuards(JwtAuthGuard)
export class DepartmentsController {
  constructor(
    @InjectRepository(Department) private deptRepo: Repository<Department>,
  ) {}

  @Get()
  async list(@Query('keyword') keyword?: string) {
    const where = keyword
      ? { name: ILike(`%${keyword}%`) }
      : {};
    const depts = await this.deptRepo.find({
      where,
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return depts;
  }
}
