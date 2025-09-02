import { FunctionComponent } from "react";
import {
  Anchor,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Card,
  Divider,
  Drawer,
  Group,
  Loader,
  Menu,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { faBell } from "@fortawesome/free-regular-svg-icons/faBell";
import {
  faArrowRotateLeft,
  faGear,
  faPowerOff,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSystem, useSystemJobs, useSystemSettings } from "@/apis/hooks";
import { Action, Search } from "@/components";
import { useNavbar } from "@/contexts/Navbar";
import { useIsOnline } from "@/contexts/Online";
import { Environment, useGotoHomepage } from "@/utilities";
import styles from "./Header.module.scss";

const AppHeader: FunctionComponent = () => {
  const { data: settings } = useSystemSettings();
  const hasLogout = settings?.auth.type === "form";

  const { show, showed } = useNavbar();

  const online = useIsOnline();
  const offline = !online;

  const { shutdown, restart, logout } = useSystem();

  const goHome = useGotoHomepage();

  const [
    notificationsOpened,
    { open: openNotifications, close: closeNotifications },
  ] = useDisclosure(false);

  const {
    data: jobs,
    isLoading: jobsLoading,
    error: jobsError,
  } = useSystemJobs();

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
            label="Notifications"
            tooltip={{ position: "left", openDelay: 2000 }}
            icon={faBell}
            size="lg"
            onClick={openNotifications}
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
        opened={notificationsOpened}
        onClose={closeNotifications}
        title="Jobs Drawer"
        position="right"
        size="md"
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
            <Stack gap="sm">
              {jobs.length === 0 && (
                <Card withBorder padding="md" radius="sm">
                  <Text size="sm" c="dimmed">
                    No jobs.
                  </Text>
                </Card>
              )}

              {jobs.map((job, idx: number) => {
                const status = job?.status;

                return (
                  <Card
                    key={job?.job_id ?? job?.job_name + idx}
                    withBorder
                    radius="sm"
                    padding="md"
                  >
                    <Group
                      justify="space-between"
                      align="center"
                      mb="xs"
                      wrap="nowrap"
                    >
                      <Text>{job?.job_name}</Text>
                      <Badge
                        variant={status === "running" ? "filled" : "light"}
                        color={
                          status === "pending"
                            ? "blue"
                            : status === "running"
                              ? "green"
                              : status === "failed"
                                ? "red"
                                : status === "completed"
                                  ? "grey"
                                  : "toto"
                        }
                      >
                        {String(status)}
                      </Badge>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
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
