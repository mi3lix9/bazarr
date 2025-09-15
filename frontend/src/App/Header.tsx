import { FunctionComponent } from "react";
import TimeAgo from "react-timeago";
import {
  Anchor,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Card,
  Divider,
  Drawer,
  Grid,
  Group,
  Loader,
  Menu,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { faBell } from "@fortawesome/free-regular-svg-icons/faBell";
import {
  faArrowRotateLeft,
  faGear,
  faPowerOff,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSystem, useSystemJobs, useSystemSettings } from "@/apis/hooks";
import { Action, Search } from "@/components";
import { useNavbar } from "@/contexts/Navbar";
import { useIsOnline } from "@/contexts/Online";
import { Environment, useGotoHomepage } from "@/utilities";
import styles from "./Header.module.scss";
import Jobs = System.Jobs;
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QueryKeys } from "@/apis/queries/keys";
import api from "@/apis/raw";

const AppHeader: FunctionComponent = () => {
  const { data: settings } = useSystemSettings();
  const hasLogout = settings?.auth.type === "form";

  const { show, showed } = useNavbar();

  const online = useIsOnline();
  const offline = !online;

  const { shutdown, restart, logout } = useSystem();

  const goHome = useGotoHomepage();

  const [
    jobsManagerOpened,
    { open: openJobsManager, close: closeJobsManager },
  ] = useDisclosure(false);

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
    <AppShell.Header p="md" className={styles.header}>
      <Group justify="space-between" wrap="nowrap">
        <Group wrap="nowrap">
          <Burger
            opened={showed}
            onClick={() => show(!showed)}
            size="sm"
            hiddenFrom="sm"
          ></Burger>
          <Anchor onClick={goHome}>
            <Avatar
              alt="brand"
              size={32}
              src={`${Environment.baseUrl}/images/logo64.png`}
            ></Avatar>
          </Anchor>
          <Badge size="lg" radius="sm" variant="brand" visibleFrom="sm">
            Bazarr
          </Badge>
        </Group>
        <Group gap="xs" justify="right" wrap="nowrap">
          <Search></Search>
          <Action
            label="Jobs Manager"
            tooltip={{ position: "left", openDelay: 2000 }}
            icon={faBell}
            size="lg"
            // loading={Boolean(
            //   jobs?.filter((job) => job.status === "running").length,
            // )}
            onClick={openJobsManager}
          ></Action>
          <Menu>
            <Menu.Target>
              <Action
                label="System"
                tooltip={{ position: "left", openDelay: 2000 }}
                loading={offline}
                c={offline ? "yellow" : undefined}
                icon={faGear}
                size="lg"
              ></Action>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<FontAwesomeIcon icon={faArrowRotateLeft} />}
                onClick={() => restart()}
              >
                Restart
              </Menu.Item>
              <Menu.Item
                leftSection={<FontAwesomeIcon icon={faPowerOff} />}
                onClick={() => shutdown()}
              >
                Shutdown
              </Menu.Item>
              <Divider hidden={!hasLogout}></Divider>
              <Menu.Item hidden={!hasLogout} onClick={() => logout()}>
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <Drawer
        opened={jobsManagerOpened}
        onClose={closeJobsManager}
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
              {jobs.length > 0 &&
                (() => {
                  const grouped = (jobs as Jobs[]).reduce<
                    Record<string, Jobs[]>
                  >((acc, job) => {
                    const key = job?.status ?? "unknown";
                    (acc[key] ||= []).push(job);
                    return acc;
                  }, {});

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
                      <Stack key={status} gap="xs">
                        <Group justify="space-between" wrap="nowrap">
                          <Badge
                            variant={status === "running" ? "filled" : "light"}
                            radius="sm"
                            size="md"
                          >
                            {status}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {grouped[status as string].length} job
                            {grouped[status as string].length > 1 ? "s" : ""}
                          </Text>
                        </Group>

                        <Stack gap="xs">
                          {grouped[status as string].map((job) => (
                            <Card
                              key={job?.job_id}
                              withBorder
                              radius="sm"
                              padding="sm"
                            >
                              <Grid columns={12}>
                                <Grid.Col span={8}>
                                  <Text truncate="end">{job?.job_name}</Text>
                                </Grid.Col>
                                <Grid.Col span={4}>
                                  <Badge size="sm">
                                    <TimeAgo
                                      date={job?.last_run_time}
                                      minPeriod={5}
                                    />
                                  </Badge>
                                  {status === "pending" && (
                                    <Action
                                      label="Cancel job"
                                      tooltip={{
                                        position: "left",
                                        openDelay: 500,
                                      }}
                                      icon={faTrash}
                                      size="md"
                                      loading={isCancelling}
                                      onClick={() =>
                                        job?.job_id && deleteJob(job.job_id)
                                      }
                                    />
                                  )}
                                </Grid.Col>
                                {job?.is_progress && (
                                  <Grid.Col span={12}>
                                    <Progress
                                      value={
                                        (job.progress_value /
                                          job.progress_max) *
                                        100
                                      }
                                      size="sm"
                                      radius="sm"
                                    />
                                    <Text>
                                      {job.progress_message}{" "}
                                      {job.progress_value} out of{" "}
                                      {job.progress_max}
                                    </Text>
                                  </Grid.Col>
                                )}
                              </Grid>
                            </Card>
                          ))}
                        </Stack>
                      </Stack>
                    ));
                })()}
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
                {typeof jobs === "string"
                  ? jobs
                  : JSON.stringify(jobs, null, 2)}
              </Text>
            </Card>
          ))}
      </Drawer>
    </AppShell.Header>
  );
};

export default AppHeader;
