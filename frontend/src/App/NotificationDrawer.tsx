import { FunctionComponent } from "react";
import TimeAgo from "react-timeago";
import {
  Badge,
  Button,
  Card,
  Drawer,
  Group,
  Loader,
  RingProgress,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  faCheck,
  faClock,
  faQuestion,
  faSpinner,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSystemJobs } from "@/apis/hooks";
import Jobs = System.Jobs;
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startCase } from "lodash";
import { QueryKeys } from "@/apis/queries/keys";
import api from "@/apis/raw";

interface NotificationDrawerProps {
  opened: boolean;
  onClose: () => void;
}

const NotificationDrawer: FunctionComponent<NotificationDrawerProps> = ({
  opened,
  onClose,
}) => {
  const {
    data: jobs,
    isLoading: jobsLoading,
    error: jobsError,
  } = useSystemJobs();
  const client = useQueryClient();
  const { mutate: deleteJob, isPending: isCancelling } = useMutation({
    mutationKey: [QueryKeys.System, QueryKeys.Jobs, "delete"],
    mutationFn: (id: number) => api.system.deleteJobs(id),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: [QueryKeys.System, QueryKeys.Jobs],
      });
    },
  });

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Jobs Manager"
      position="right"
      size="lg"
      overlayProps={{ opacity: 0.35, blur: 2 }}
    >
      {jobsLoading && (
        <Group justify="center" p="md">
          <Loader size="sm" />
          <Text size="sm">Loading jobs…</Text>
        </Group>
      )}

      {!jobsLoading && jobsError && (
        <Card withBorder padding="md" radius="sm">
          <Text c="red.6" size="sm">
            Failed to load jobs.
          </Text>
        </Card>
      )}

      {!jobsLoading &&
        !jobsError &&
        (Array.isArray(jobs) ? (
          <>
            {jobs.length > 0 ? (
              (() => {
                const grouped = (jobs as Jobs[]).reduce<Record<string, Jobs[]>>(
                  (acc, job) => {
                    const key = job?.status ?? "unknown";
                    (acc[key] ||= []).push(job);
                    return acc;
                  },
                  {},
                );

                const order: Array<keyof typeof grouped | "unknown"> = [
                  "running",
                  "pending",
                  "failed",
                  "completed",
                  "unknown",
                ];

                return order
                  .filter((status) => grouped[status as string]?.length)
                  .map((status) => (
                    <Stack key={status} mt="md">
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs">
                          <FontAwesomeIcon
                            icon={
                              status === "running"
                                ? faSpinner
                                : status === "pending"
                                  ? faClock
                                  : status === "failed"
                                    ? faXmark
                                    : status === "completed"
                                      ? faCheck
                                      : faQuestion
                            }
                            spin={status === "running"}
                          />
                          <Title order={3}>{startCase(status)}</Title>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {grouped[status as string].length} job
                          {grouped[status as string].length > 1 ? "s" : ""}
                        </Text>
                      </Group>

                      <Stack>
                        {grouped[status as string]
                          .sort((a, b) => {
                            const timeA = new Date(
                              a?.last_run_time || 0,
                            ).getTime();
                            const timeB = new Date(
                              b?.last_run_time || 0,
                            ).getTime();
                            return timeB - timeA; // Latest first (descending order)
                          })
                          .map((job, index) => (
                            <Stack
                              gap="xs"
                              key={job?.job_id ?? `job-fallback-${index}`}
                            >
                              <Group justify="flex-end" wrap="nowrap">
                                <Badge
                                  size="md"
                                  variant="filled"
                                  color="blue"
                                  style={{ textTransform: "uppercase" }}
                                >
                                  <TimeAgo
                                    date={job?.last_run_time || new Date()}
                                    minPeriod={5}
                                  />
                                </Badge>
                              </Group>
                              <Card
                                withBorder
                                radius="md"
                                padding="sm"
                                style={{
                                  backgroundColor:
                                    "var(--mantine-color-dark-6)",
                                }}
                              >
                                <Stack gap="xs">
                                  <Group
                                    gap="md"
                                    align="flex-start"
                                    wrap="nowrap"
                                  >
                                    {job?.is_progress &&
                                      status !== "pending" && (
                                        <Tooltip
                                          label={`${job.progress_value}/${job.progress_max}`}
                                          position="right"
                                        >
                                          <RingProgress
                                            size={60}
                                            thickness={6}
                                            sections={[
                                              {
                                                value:
                                                  job.progress_max > 0
                                                    ? (job.progress_value /
                                                        job.progress_max) *
                                                      100
                                                    : 0,
                                                color: "blue",
                                              },
                                            ]}
                                            label={
                                              <Text
                                                ta="center"
                                                size="xs"
                                                fw={700}
                                              >
                                                {job.progress_max > 0
                                                  ? Math.round(
                                                      (job.progress_value /
                                                        job.progress_max) *
                                                        100,
                                                    )
                                                  : 0}
                                                %
                                              </Text>
                                            }
                                          />
                                        </Tooltip>
                                      )}
                                    <Stack gap="xs" style={{ flex: 1 }}>
                                      <Text fw={500} size="md">
                                        {job?.job_name}
                                      </Text>
                                      {job?.progress_message && (
                                        <Text
                                          size="sm"
                                          c="dimmed"
                                          lineClamp={2}
                                        >
                                          {job.progress_message}
                                        </Text>
                                      )}
                                    </Stack>
                                  </Group>

                                  {status === "pending" && (
                                    <Group justify="flex-start">
                                      <Button
                                        variant="filled"
                                        color="red"
                                        loading={isCancelling}
                                        onClick={() =>
                                          job?.job_id && deleteJob(job.job_id)
                                        }
                                      >
                                        Cancel Job
                                      </Button>
                                    </Group>
                                  )}
                                </Stack>
                              </Card>
                            </Stack>
                          ))}
                      </Stack>
                    </Stack>
                  ));
              })()
            ) : (
              <Text c="dimmed" ta="center" py="xl">
                No jobs to display
              </Text>
            )}
          </>
        ) : (
          <Card withBorder padding="md" radius="sm">
            <Text size="sm" c="dimmed" mb="xs">
              Jobs
            </Text>
            <Text
              size="xs"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {typeof jobs === "string" ? jobs : JSON.stringify(jobs, null, 2)}
            </Text>
          </Card>
        ))}
    </Drawer>
  );
};

export default NotificationDrawer;
