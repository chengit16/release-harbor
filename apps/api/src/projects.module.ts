import {
  Body,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
} from '@nestjs/common'
import { ProjectCatalog, type ProjectStore } from '@release-harbor/domain'
const PROJECT_STORE = Symbol('PROJECT_STORE')
const WORKSPACE = Symbol('WORKSPACE')

@Injectable()
class ProjectsService {
  private readonly catalog: ProjectCatalog
  constructor(
    @Inject(PROJECT_STORE) store: ProjectStore,
    @Inject(WORKSPACE) private readonly workspaceId: string,
  ) {
    this.catalog = new ProjectCatalog(store)
  }
  list() {
    return this.catalog.list(this.workspaceId)
  }
  get(id: string) {
    return this.catalog.get(this.workspaceId, id)
  }
  create(input: unknown) {
    return this.catalog.create(this.workspaceId, input)
  }
}
@Controller('projects')
class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}
  @Get()
  async list() {
    return { items: await this.projects.list() }
  }
  @Get(':id')
  async get(@Param('id') id: string) {
    return { project: await this.projects.get(id) }
  }
  @Post()
  async create(@Body() body: unknown) {
    return { project: await this.projects.create(body) }
  }
}
@Module({})
export class ProjectsModule {
  static register(store: ProjectStore, workspaceId: string): DynamicModule {
    return {
      module: ProjectsModule,
      controllers: [ProjectsController],
      providers: [
        ProjectsService,
        { provide: PROJECT_STORE, useValue: store },
        { provide: WORKSPACE, useValue: workspaceId },
      ],
    }
  }
}
