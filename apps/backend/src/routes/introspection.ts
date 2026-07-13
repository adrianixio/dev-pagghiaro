import { Elysia } from 'elysia';
import { getProject } from '../config-store';
import { buildServiceIntrospection } from '../service-introspection';

export const introspectionRouter = new Elysia().get(
  '/api/projects/:projectId/services/:serviceId/introspect',
  async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }
    const service = project.services.find((s) => s.id === params.serviceId);
    if (!service) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    return buildServiceIntrospection(project, service);
  },
);
